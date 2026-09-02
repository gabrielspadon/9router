// Issue #2504: a connection can already override baseUrl and apiType, but the
// dashboard had nothing to show. The registry default was never projected, so a
// form had no value to display or to prefill an override from, and apiType was
// missing from the client-facing field list, which made it write-only: an
// editor could set it and never read it back.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AI_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/providers";

describe("the default endpoint is visible (#2504)", () => {
  it("projects the registry base URL and format for an api-key provider", () => {
    const minimax = AI_PROVIDERS["minimax"];
    expect(minimax.defaultBaseUrl).toMatch(/^https:\/\//);
    expect(minimax.defaultApiType).toBeTruthy();
  });

  it("covers the api-key providers the report names, not just one", () => {
    for (const id of ["minimax", "kimi"]) {
      if (!AI_PROVIDERS[id]) continue;
      expect(AI_PROVIDERS[id].defaultBaseUrl, id).toBeTruthy();
    }
  });

  it("projects it for most of the api-key catalogue rather than a handful", () => {
    const ids = Object.keys(APIKEY_PROVIDERS);
    const withDefault = ids.filter((id) => AI_PROVIDERS[id]?.defaultBaseUrl);
    expect(withDefault.length).toBeGreaterThan(ids.length / 2);
  });

  it("omits the field rather than inventing one where the registry has none", () => {
    for (const entry of Object.values(AI_PROVIDERS)) {
      if ("defaultBaseUrl" in entry) expect(typeof entry.defaultBaseUrl).toBe("string");
      if ("defaultApiType" in entry) expect(typeof entry.defaultApiType).toBe("string");
    }
  });
});

describe("the override can be read back (#2504)", () => {
  const clientRoute = readFileSync(new URL("../../src/app/api/providers/client/route.js", import.meta.url), "utf8");

  it("exposes apiType beside baseUrl, so the pair is not half-readable", () => {
    const list = clientRoute.slice(
      clientRoute.indexOf("const SAFE_PSD_FIELDS"),
      clientRoute.indexOf("];", clientRoute.indexOf("const SAFE_PSD_FIELDS")),
    );
    expect(list).toContain('"baseUrl"');
    expect(list).toContain('"apiType"');
  });

  it("still withholds the credential fields", () => {
    const list = clientRoute.slice(
      clientRoute.indexOf("const SAFE_PSD_FIELDS"),
      clientRoute.indexOf("];", clientRoute.indexOf("const SAFE_PSD_FIELDS")),
    );
    for (const secret of ["apiKey", "clientSecret", "copilotToken", "secretAccessKey", "customHeaders"]) {
      expect(list).not.toContain(`"${secret}"`);
    }
  });
});
