import { describe, expect, it } from "vitest";
import { describePathFailure } from "@/lib/db/paths.js";
import { DATA_DIR } from "@/lib/dataDir.js";

// The data directory is mode 0700 and its files 0600, which is right for a store
// holding OAuth refresh tokens and plaintext API keys. It also means one start
// under sudo leaves everything owned by root, and every later start as the
// normal user fails on the first read — which surfaced as a bare "Internal
// server error" on the providers page with nothing naming the cause (#1983).
const denied = (code) => Object.assign(new Error("permission denied"), { code });

describe("a permission failure on the data directory says so (#1983)", () => {
  it("names the path, the code and the user it is running as", () => {
    const out = describePathFailure(denied("EACCES"), "/home/u/.tokenproxy/db");
    expect(out.message).toContain("/home/u/.tokenproxy/db");
    expect(out.message).toContain("EACCES");
    expect(out.message).toMatch(/uid \d+|user \w+/);
  });

  it("names sudo, which is the cause in nearly every report of this", () => {
    expect(describePathFailure(denied("EPERM"), "/x").message).toContain("sudo");
  });

  it("gives the command that fixes it, pointed at the real data directory", () => {
    const out = describePathFailure(denied("EACCES"), "/x");
    expect(out.message).toContain("chown -R");
    expect(out.message).toContain(DATA_DIR);
  });

  it("keeps the code and the original error, so callers can still branch on it", () => {
    const original = denied("EROFS");
    const out = describePathFailure(original, "/x");
    expect(out.code).toBe("EROFS");
    expect(out.cause).toBe(original);
  });

  it("covers the three codes a wrong owner or a read-only mount produces", () => {
    for (const code of ["EACCES", "EPERM", "EROFS"])
      expect(describePathFailure(denied(code), "/x").message).toContain(code);
  });

  it("passes anything else straight through, unwrapped", () => {
    // A missing directory or a full disk is not a permissions story and must not
    // be described as one.
    for (const code of ["ENOENT", "ENOSPC", "EMFILE"]) {
      const original = denied(code);
      expect(describePathFailure(original, "/x")).toBe(original);
    }
    const plain = new Error("something else");
    expect(describePathFailure(plain, "/x")).toBe(plain);
    expect(describePathFailure(null, "/x")).toBe(null);
  });
});
