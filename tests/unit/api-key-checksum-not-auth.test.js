import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const git = (...args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

// THE CHECKSUM IN A KEY IS FORGEABLE AND MUST NEVER BE AN AUTH DECISION.
//
// sk-{machineId}-{keyId}-{crc8} carries an HMAC over machineId and keyId, and
// both of those travel inside the key in plaintext. The HMAC secret,
// API_KEY_SECRET, is unset on the deployed unit and falls back to a literal that
// ships in this source tree, so anyone holding the source can compute a valid
// crc for any machineId and keyId they choose. The machineId is identical for
// every key on one install, which leaves nothing about the crc that an attacker
// does not already have.
//
// That is harmless today for exactly one reason: authentication is an exact
// match on the whole key string, so the crc is never consulted. It stops being
// harmless the moment anything trusts it. This suite makes that moment fail here
// rather than in production.
//
// The helpers are kept rather than deleted because they are the only
// machine-readable description of the key format, and a format description is
// worth having. Fencing them is cheaper than losing them.
describe("the API key checksum is never an authentication decision", () => {
  const CRC_HELPERS = ["parseApiKey", "verifyApiKeyCrc", "isNewFormatKey"];

  it("no production file imports the checksum helpers", () => {
    // Tracked files only, so an untracked scratch file cannot fail the build,
    // and generated build output under cli/app is excluded because it is a
    // compiled copy of the same sources rather than a second consumer.
    const production = git("ls-files", "src", "open-sse", "cli/src").filter(
      (f) => /\.(js|mjs|cjs)$/.test(f) && f !== "src/shared/utils/apiKey.js",
    );
    expect(production.length).toBeGreaterThan(100);

    const offenders = [];
    for (const f of production) {
      const body = readFileSync(path.join(ROOT, f), "utf8");
      for (const helper of CRC_HELPERS) {
        if (new RegExp(`\\b${helper}\\b`).test(body)) offenders.push(`${f} -> ${helper}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("validateApiKey decides on an exact key match, not on the key's shape", () => {
    const body = readFileSync(
      path.join(ROOT, "src/lib/db/repos/apiKeysRepo.js"),
      "utf8",
    );
    const fn = body.slice(body.indexOf("export async function validateApiKey"));
    const decl = fn.slice(0, fn.indexOf("\n}"));

    // The whole key is the lookup term. A prefix, a parsed half, or a
    // recomputed checksum would each admit a key nobody issued.
    expect(decl).toContain("WHERE key = ?");
    for (const helper of CRC_HELPERS) {
      expect(decl).not.toContain(helper);
    }
    // Parameterised, never interpolated.
    expect(decl).not.toMatch(/`SELECT[^`]*\$\{/);
  });

  it("the checksum secret's fallback is documented as a non-secret", () => {
    // If someone later randomises this default they will invalidate the
    // checksum of every key already issued. That is survivable only while
    // nothing reads the checksum, which is what the first test pins. The
    // comment is what tells them so before they try.
    const src = readFileSync(
      path.join(ROOT, "src/shared/utils/apiKey.js"),
      "utf8",
    );
    expect(src).toMatch(/NOT a secret/);
    expect(src).toMatch(/API_KEY_CHECKSUM_SECRET/);
    // The name must not claim secrecy it does not have.
    expect(src).not.toMatch(/^const API_KEY_SECRET\b/m);
  });
});
