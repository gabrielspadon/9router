import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  generateApiKeyWithMachine,
  parseApiKey,
  verifyApiKeyCrc,
  isNewFormatKey,
  KEY_ID_DISPLAY_CHARS,
} from "../../src/shared/utils/apiKey.js";

const MACHINE = "a1b2c3d4e5f6a7b8";

// The checksum secret is not a secret: it defaults to a literal in source, and
// it is computed over machineId and keyId, both of which travel inside the key
// in plaintext. The test can therefore build a well-formed key of any shape,
// which is what makes the legacy-width case below testable at all.
const CHECKSUM_DEFAULT = "endpoint-proxy-api-key-secret";
const crcFor = (machineId, keyId) =>
  createHmac("sha256", process.env.API_KEY_SECRET || CHECKSUM_DEFAULT)
    .update(machineId + keyId)
    .digest("hex")
    .slice(0, 8);
const keyOf = (machineId, keyId) =>
  `sk-${machineId}-${keyId}-${crcFor(machineId, keyId)}`;

// generateKeyId drew six characters from a 36-character alphabet with
// Math.random(): 36^6, about 2.18e9, or 31 bits, from a generator whose internal
// state is recoverable from a handful of outputs. The HMAC tail added nothing,
// for the reason stated above. So the whole guessing difficulty of a minted key
// was those 31 bits, and less than that against anyone holding one other key
// minted by the same process.
describe("API key secret material comes from the CSPRNG", () => {
  it("mints a 128-bit keyId, hex encoded", () => {
    expect(generateApiKeyWithMachine(MACHINE).keyId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("does not draw from Math.random", () => {
    // The discriminating case. Pinned to a constant, the previous implementation
    // returns the same six characters on every call, so two keys collide. A
    // CSPRNG-backed one is unaffected. Math.random is a property of Math rather
    // than a global binding, so it is saved and restored directly instead of
    // through vi.stubGlobal.
    const saved = Math.random;
    try {
      Math.random = () => 0.5;
      const a = generateApiKeyWithMachine(MACHINE);
      const b = generateApiKeyWithMachine(MACHINE);
      expect(a.keyId).not.toBe(b.keyId);
      expect(a.key).not.toBe(b.key);
    } finally {
      Math.random = saved;
    }
  });

  it("mints distinct keys across a large sample", () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) seen.add(generateApiKeyWithMachine(MACHINE).keyId);
    expect(seen.size).toBe(2000);
  });

  it("keeps the keyId free of the format delimiter", () => {
    // parseApiKey splits on "-" and requires exactly four parts, so a keyId
    // carrying one would make its own key unparseable.
    for (let i = 0; i < 200; i++) {
      const { key, keyId } = generateApiKeyWithMachine(MACHINE);
      expect(keyId).not.toContain("-");
      expect(key.split("-")).toHaveLength(4);
    }
  });
});

describe("API key parsing survives the widening", () => {
  it("round-trips a freshly minted key", () => {
    const { key, keyId } = generateApiKeyWithMachine(MACHINE);
    expect(parseApiKey(key)).toMatchObject({ machineId: MACHINE, keyId, isNewFormat: true });
    expect(verifyApiKeyCrc(key)).toBe(true);
    expect(isNewFormatKey(key)).toBe(true);
  });

  it("still accepts a 6-character keyId minted before the widening", () => {
    // The fleet holds keys issued under the old width. Rejecting them here would
    // lock every host out at once, which is a worse outcome than the weakness the
    // widening addresses. Those keys stay weak; rotation is their remedy.
    const legacy = keyOf(MACHINE, "xk29zq");
    expect(parseApiKey(legacy)).toMatchObject({
      machineId: MACHINE,
      keyId: "xk29zq",
      isNewFormat: true,
    });
    expect(verifyApiKeyCrc(legacy)).toBe(true);
  });

  it("rejects a key whose checksum was tampered with", () => {
    const parts = generateApiKeyWithMachine(MACHINE).key.split("-");
    parts[3] = parts[3] === "00000000" ? "11111111" : "00000000";
    expect(parseApiKey(parts.join("-"))).toBeNull();
    expect(verifyApiKeyCrc(parts.join("-"))).toBe(false);
  });

  it("rejects a key whose keyId was tampered with", () => {
    const parts = generateApiKeyWithMachine(MACHINE).key.split("-");
    parts[2] = "f".repeat(parts[2].length);
    expect(parseApiKey(parts.join("-"))).toBeNull();
  });

  it("rejects a checksum of the wrong length rather than throwing", () => {
    // timingSafeEqual throws on a length mismatch, so the length is compared
    // first. A truncated key is a refusal, never a 500.
    const parts = generateApiKeyWithMachine(MACHINE).key.split("-");
    parts[3] = "ab";
    expect(() => parseApiKey(parts.join("-"))).not.toThrow();
    expect(parseApiKey(parts.join("-"))).toBeNull();
  });

  it("still parses the two-part legacy format", () => {
    expect(parseApiKey("sk-legacy12")).toMatchObject({
      machineId: null,
      keyId: "legacy12",
      isNewFormat: false,
    });
    expect(verifyApiKeyCrc("sk-legacy12")).toBe(true);
  });

  it("refuses anything that is not a key", () => {
    for (const bad of [null, undefined, "", "nope", "sk", 42, {}]) {
      expect(parseApiKey(bad)).toBeNull();
      expect(verifyApiKeyCrc(bad)).toBe(false);
    }
  });
});

describe("the display width leaves the key unguessable", () => {
  it("shows far less than it withholds", () => {
    const { keyId } = generateApiKeyWithMachine(MACHINE);
    expect(KEY_ID_DISPLAY_CHARS).toBeLessThan(keyId.length / 2);
    // Hex, so each withheld character is 4 bits.
    expect((keyId.length - KEY_ID_DISPLAY_CHARS) * 4).toBeGreaterThanOrEqual(100);
  });
});
