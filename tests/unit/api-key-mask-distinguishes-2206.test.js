import { describe, expect, it } from "vitest";
import { buildRecentRequestRow } from "../../src/lib/db/repos/usageRepo.js";

const mask = (k) => buildRecentRequestRow({ apiKey: k, tokens: {} }).apiKey;
const MACHINE = "a1b2c3d4e5f6g7h8";
const key = (keyId, crc) => `sk-${MACHINE}-${keyId}-${crc}`;

// The old mask was the first 8 characters. For the sk-{machineId}-{keyId}-{crc}
// format that is "sk-" plus five characters of the machineId, which is the same
// for every key issued on one install — so the mask distinguished nothing, and
// the dashboard showed an identical value for every request.
describe("the API key mask distinguishes keys on one install (#2206)", () => {
  it("two keys from the same install do not mask identically", () => {
    expect(mask(key("xk29zq", "4f"))).not.toBe(mask(key("mm01aa", "9c")));
  });

  it("shows the per-key half", () => {
    expect(mask(key("xk29zq", "4f"))).toContain("xk29zq");
  });

  it("never shows the machineId, which would make the key reconstructible", () => {
    // The crc is derived from machineId + keyId. A display carrying both halves
    // hands a reader everything needed to rebuild the key.
    const shown = mask(key("xk29zq", "4f"));
    expect(shown).not.toContain(MACHINE);
    for (let n = 5; n <= MACHINE.length; n++) {
      expect(shown, `leaks ${n} chars of the machineId`).not.toContain(MACHINE.slice(0, n));
    }
  });

  it("never returns the whole key", () => {
    const k = key("xk29zq", "4f");
    expect(mask(k)).not.toBe(k);
    expect(mask(k).length).toBeLessThan(k.length);
    expect(mask(k)).not.toContain("4f-");
  });

  it("still masks an old-format key, which has no keyId to show", () => {
    expect(mask("sk-legacy12")).toBe("sk-legac***");
    expect(mask("short")).toBe("s***");
  });

  it("the keyName fallback uses the mask too, not a raw prefix slice", async () => {
    // Unknown keys now have an opaque aggregate identity. Their display keeps
    // the safe mask and a nonsecret HMAC suffix so same-mask keys remain distinct.
    const { readFileSync } = await import("node:fs");
    const repo = readFileSync(new URL("../../src/lib/db/repos/usageRepo.js", import.meta.url), "utf8");
    expect(repo).not.toMatch(/apiKeyVal\.slice\(0, ?8\)/);
    expect(repo).not.toMatch(/r\.apiKey\.slice\(0, ?8\)/);
    expect(repo).toContain("keyName: keyInfo?.name || `${apiKeyMasked} (${apiKeyKey.slice(-8)})`");
  });

  it("reports null for no key at all", () => {
    expect(mask(null)).toBeNull();
    expect(mask("")).toBeNull();
  });
});
