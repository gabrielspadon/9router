import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// P-F1: deriveKey() called machineIdSync() — a ~2ms subprocess — on EVERY
// encrypt/decrypt, and row decryption runs per request inside the serialized
// selection queue. The derived key is now cached at module scope. The spy
// reaches machineIdSync through the same require cache the module's lazy
// `require('node-machine-id')` uses (vi.mock does not intercept that CJS
// require under vitest).
import {
  encryptSecretJson,
  decryptSecretJson,
  _resetSecretKeyCacheForTests,
} from "../../src/lib/db/helpers/secretCol.js";

const nodeMachineId = require("node-machine-id");
let machineIdSpy;

describe("secretCol key cache (P-F1)", () => {
  beforeEach(() => {
    _resetSecretKeyCacheForTests();
    machineIdSpy = vi.spyOn(nodeMachineId, "machineIdSync");
  });
  afterEach(() => {
    machineIdSpy.mockRestore();
    _resetSecretKeyCacheForTests();
  });

  it("derives the machine-id key once across many encrypts and decrypts", () => {
    const stored = [];
    for (let i = 0; i < 50; i++) stored.push(encryptSecretJson({ apiKey: `sk-${i}` }));
    for (let i = 0; i < stored.length; i++) {
      expect(decryptSecretJson(stored[i])).toEqual({ apiKey: `sk-${i}` });
    }
    expect(machineIdSpy).toHaveBeenCalledTimes(1);
  });

  it("round-trips through the cached key", () => {
    const value = { apiKey: "sk-x", nested: { n: 1 } };
    expect(decryptSecretJson(encryptSecretJson(value))).toEqual(value);
    expect(machineIdSpy).toHaveBeenCalledTimes(1);
  });
});
