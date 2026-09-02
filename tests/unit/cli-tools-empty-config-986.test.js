/**
 * #986 "Error installing Claude Cowork and Codex".
 *
 * readExistingConfig() refuses to overwrite a config file it could not parse,
 * which is right for a file that still holds the user's providers or OAuth
 * tokens. A file of zero bytes holds neither, and `JSON.parse("")` throws, so
 * an empty `~/.codex/auth.json` or Copilot `settings.json` made every apply
 * fail with "refusing to overwrite it" and no way out but deleting the file.
 *
 * The writers truncate before they write, so an apply interrupted mid-write
 * produces exactly that 0-byte file — TokenProxy's own write path could put the
 * install permanently beyond its own reach.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readExistingConfig } from "@/lib/cliTools/readExistingConfig.js";

// The two parsers the real call sites pass in.
const parseJSONC = (raw) => JSON.parse(raw.replace(/,(\s*[}\]])/g, "$1"));

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenproxy-empty-cfg-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const write = async (name, content) => {
  const file = path.join(dir, name);
  await fsp.writeFile(file, content);
  return file;
};

describe("an empty config file is 'start fresh', not 'unreadable' (#986)", () => {
  it("treats a 0-byte auth.json as absent so the apply can proceed", async () => {
    const file = await write("auth.json", "");
    // Absent and empty must agree: codex-settings does `(await …) ?? {}`.
    await expect(readExistingConfig(file, JSON.parse)).resolves.toBeNull();
  });

  it("treats a whitespace-only file as absent too", async () => {
    const file = await write("settings.json", "\n\n  \t\r\n");
    await expect(readExistingConfig(file, parseJSONC)).resolves.toBeNull();
  });

  it("does not leave the caller with the old permanent-failure error", async () => {
    const file = await write("auth.json", "");
    await expect(readExistingConfig(file, JSON.parse)).resolves.not.toThrow;
    // The file is untouched either way — reading never writes.
    expect(fs.readFileSync(file, "utf-8")).toBe("");
  });
});

describe("the refusal still stands for a file with content (#986)", () => {
  it("still throws on a truncated JSON object, and leaves it alone", async () => {
    const raw = '{"tokens": {"access": "keep-me"';
    const file = await write("auth.json", raw);
    await expect(readExistingConfig(file, JSON.parse)).rejects.toThrow(/refusing to overwrite it/);
    expect(fs.readFileSync(file, "utf-8")).toBe(raw);
  });

  it("still throws on malformed TOML", async () => {
    const file = await write("config.toml", "not = = toml");
    await expect(
      readExistingConfig(file, () => { throw new SyntaxError("bad TOML"); })
    ).rejects.toThrow(/refusing to overwrite it/);
  });

  it("one non-whitespace byte is enough to keep the refusal", async () => {
    // The narrowest possible boundary check: the guard must key on emptiness,
    // never on "the parser did not like it".
    const file = await write("auth.json", "  x  ");
    await expect(readExistingConfig(file, JSON.parse)).rejects.toThrow(/refusing to overwrite it/);
  });

  it("a file that parses to a falsy value is still returned, not nulled", async () => {
    const file = await write("auth.json", "null");
    await expect(readExistingConfig(file, JSON.parse)).resolves.toBeNull();
    const zero = await write("zero.json", "0");
    await expect(readExistingConfig(zero, JSON.parse)).resolves.toBe(0);
  });

  it("a non-ENOENT read failure still propagates", async () => {
    const asDirectory = path.join(dir, "auth.json");
    fs.mkdirSync(asDirectory);
    await expect(readExistingConfig(asDirectory, JSON.parse)).rejects.toThrow();
  });
});
