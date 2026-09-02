import { describe, it, expect } from "vitest";
import {
  AI_PROVIDERS,
  FREE_PROVIDERS,
  NO_AUTH_PROVIDER_IDS,
  isNoAuthProvider,
} from "@/shared/constants/providers.js";

describe("no-auth providers are found by property, not by category (#3269)", () => {
  it("lists every provider whose registry entry sets noAuth", () => {
    const expected = Object.keys(AI_PROVIDERS).filter((id) => AI_PROVIDERS[id].noAuth);
    expect([...NO_AUTH_PROVIDER_IDS].sort()).toEqual(expected.sort());
    expect(expected.length).toBeGreaterThan(0);
  });

  it("includes searxng, which is freeTier and so was missing from the free bucket", () => {
    expect(FREE_PROVIDERS.searxng).toBeUndefined();
    expect(NO_AUTH_PROVIDER_IDS).toContain("searxng");
    expect(isNoAuthProvider("searxng")).toBe(true);
  });

  it("covers the other no-auth providers outside the free category", () => {
    for (const id of ["edge-tts", "google-tts", "coqui", "tortoise", "local-device"]) {
      expect(isNoAuthProvider(id), id).toBe(true);
      expect(FREE_PROVIDERS[id], id).toBeUndefined();
    }
  });

  it("still covers the no-auth providers that are in the free category", () => {
    for (const id of Object.keys(FREE_PROVIDERS).filter((k) => FREE_PROVIDERS[k].noAuth)) {
      expect(NO_AUTH_PROVIDER_IDS, id).toContain(id);
    }
  });

  it("says no for a provider that needs a credential, and for junk", () => {
    expect(isNoAuthProvider("openai")).toBe(false);
    expect(isNoAuthProvider("does-not-exist")).toBe(false);
    expect(isNoAuthProvider(undefined)).toBe(false);
  });
});
