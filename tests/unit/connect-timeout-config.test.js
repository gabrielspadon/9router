import { describe, expect, it } from "vitest";
import {
  CONNECT_TIMEOUT_DEFAULT_MS,
  isValidConnectTimeoutMs,
  resolveConnectTimeoutMs,
} from "../../open-sse/config/connectTimeout.js";

describe("connect timeout resolution", () => {
  it("uses provider, registry, global, then env precedence", () => {
    const all = { providerOverride: 8000, registryTimeout: 120000, globalTimeout: 15000, envTimeout: 60000 };
    expect(resolveConnectTimeoutMs(all)).toBe(8000);
    expect(resolveConnectTimeoutMs({ ...all, providerOverride: undefined })).toBe(120000);
    expect(resolveConnectTimeoutMs({ ...all, providerOverride: undefined, registryTimeout: undefined })).toBe(15000);
    expect(resolveConnectTimeoutMs({ envTimeout: 60000 })).toBe(60000);
    expect(CONNECT_TIMEOUT_DEFAULT_MS).toBe(15000);
  });

  it.each([NaN, Infinity, -Infinity, 999, 120001, 15000.5, "15000", null, true])(
    "rejects invalid literal %s",
    (value) => expect(isValidConnectTimeoutMs(value)).toBe(false),
  );

  it.each([1000, 15000, 120000])("accepts bounded integer %s", (value) => {
    expect(isValidConnectTimeoutMs(value)).toBe(true);
  });

  it("skips invalid imported candidates", () => {
    expect(resolveConnectTimeoutMs({ providerOverride: "8000", registryTimeout: NaN, globalTimeout: 15000.5, envTimeout: 60000 })).toBe(60000);
  });
});
