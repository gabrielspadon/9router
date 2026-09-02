import { describe, expect, it } from "vitest";
import { resolveBaseUrl } from "open-sse/handlers/search/callers.js";

// #1231 asks for a self-hosted SearXNG endpoint that is not the build-time
// SEARXNG_URL. It was declined on the reading that honouring one would mean
// relaxing the SSRF guard, because a self-hosted instance sits on a private
// address. resolveBaseUrl's own docstring says otherwise: the client-supplied
// override is SSRF-hardened, "the provider's own configured baseUrl is trusted
// as-is (admin-controlled)". getProviderSetting collapsed both sources into one
// value, so the admin-controlled one inherited the client-controlled guard.
//
// providerOptions comes from the request body (open-sse/handlers/search/index.js:83);
// providerSpecificData comes from the stored connection (:84). Different trust.
const CONFIG = { baseUrl: "https://searx.example.com/search" };
const PRIVATE = "http://192.168.1.50:8080/search";

describe("an operator-stored search endpoint is trusted like the registry one (#1231)", () => {
  it("accepts a private address stored on the connection", () => {
    expect(resolveBaseUrl(CONFIG, { providerSpecificData: { baseUrl: PRIVATE } })).toBe(PRIVATE);
  });

  it("still rejects the same address supplied by the caller", () => {
    expect(() =>
      resolveBaseUrl(CONFIG, { providerOptions: { baseUrl: PRIVATE } }),
    ).toThrow();
  });

  it("a caller override still wins over the stored one, and is still guarded", () => {
    expect(() =>
      resolveBaseUrl(CONFIG, {
        providerOptions: { baseUrl: "http://169.254.169.254/latest/meta-data/" },
        providerSpecificData: { baseUrl: "https://public.example.com/search" },
      }),
    ).toThrow();
  });

  it("a public caller override is still honoured", () => {
    expect(
      resolveBaseUrl(CONFIG, { providerOptions: { baseUrl: "https://other.example.com/search/" } }),
    ).toBe("https://other.example.com/search");
  });

  it("a stored value that is not an http(s) URL is still refused", () => {
    for (const bad of ["file:///etc/passwd", "not-a-url"]) {
      expect(() => resolveBaseUrl(CONFIG, { providerSpecificData: { baseUrl: bad } }), bad).toThrow();
    }
  });

  it("falls back to the registry endpoint when nothing overrides it", () => {
    expect(resolveBaseUrl(CONFIG, {})).toBe(CONFIG.baseUrl);
  });
});
