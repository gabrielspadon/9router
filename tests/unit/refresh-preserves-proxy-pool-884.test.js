// PR #884: auth.js inflates a connection's providerSpecificData with its proxy
// resolution (connectionProxyPoolId and friends), and updateProviderCredentials
// merges a refresh onto whatever the caller passes as
// existingProviderSpecificData. chat.js passed it; fetch, imageGeneration and
// search did not, so on those paths a token refresh REPLACED the stored map and
// silently unpinned the account from its proxy pool.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const DIR = new URL("../../src/sse/handlers/", import.meta.url);

// The handlers that persist a refreshed credential.
const REFRESHERS = readdirSync(DIR)
  .filter((f) => f.endsWith(".js"))
  .filter((f) => readFileSync(new URL(f, DIR), "utf8").includes("onCredentialsRefreshed"));


// Every onCredentialsRefreshed persist block in a handler, not just the first.
function refreshCalls(file) {
  const src = readFileSync(new URL(file, DIR), "utf8");
  const out = [];
  let i = src.indexOf("onCredentialsRefreshed");
  while (i !== -1) {
    const end = src.indexOf("});", i);
    out.push(src.slice(i, end === -1 ? undefined : end + 3));
    i = src.indexOf("onCredentialsRefreshed", i + 1);
  }
  return out;
}

describe("a refresh never drops the stored providerSpecificData (#884)", () => {
  it("finds the handlers that persist a refresh", () => {
    expect(REFRESHERS.length).toBeGreaterThanOrEqual(4);
  });

  for (const f of REFRESHERS) {
    it(`${f} passes the existing map at EVERY refresh site`, () => {
      // Every site, not just the first: videoGeneration.js has two, and slicing
      // from the first occurrence alone let the second stay broken.
      for (const call of refreshCalls(f)) {
        expect(call, `${f} persists a refresh without existingProviderSpecificData`)
          .toContain("existingProviderSpecificData");
      }
    });

    it(`${f} never replaces the map with only the refreshed fields`, () => {
      for (const call of refreshCalls(f)) {
        const bare = /providerSpecificData:\s*newCreds\.providerSpecificData/.test(call)
          && !call.includes("existingProviderSpecificData");
        expect(bare, `${f} still writes the refreshed map wholesale`).toBe(false);
      }
    });
  }
});

describe("the merge itself keeps the base (#884)", () => {
  it("spreads existing under refreshed, so an untouched key survives", () => {
    const src = readFileSync(new URL("../../src/sse/services/tokenRefresh.js", import.meta.url), "utf8");
    expect(src).toContain("...(newCredentials.existingProviderSpecificData || {})");
    // Order matters: refreshed must win on a collision, existing must survive.
    const i = src.indexOf("...(newCredentials.existingProviderSpecificData || {})");
    const j = src.indexOf("...newCredentials.providerSpecificData", i);
    expect(j).toBeGreaterThan(i);
  });
});
