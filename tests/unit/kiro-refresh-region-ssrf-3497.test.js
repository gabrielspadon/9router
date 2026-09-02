import { describe, it, expect, vi, beforeEach } from "vitest";

// The Kiro IDC refresh POSTs clientId, clientSecret and refreshToken to a host
// built by interpolating a persisted region. The executor, the model catalog
// and the connection test all run assertValidAwsRegion before egress; this
// background path did not, so a stored region re-hosted the credential POST
// with no user action at all (#3497).
const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { refreshKiroToken } = await import("../../open-sse/services/tokenRefresh/providers.js");

const base = { authMethod: "idc", clientId: "id", clientSecret: "secret" };
const ok = () => ({
  ok: true,
  json: async () => ({ accessToken: "at", refreshToken: "rt2", expiresIn: 3600 }),
  text: async () => "",
});

describe("Kiro IDC refresh region pinning (#3497)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(ok());
  });

  it.each([
    ["a.evil.example/b", "path-split re-host"],
    ["us-east-1.amazonaws.com.evil.example", "suffix re-host"],
    ["US-EAST-1", "wrong case"],
    ["us-east-1/", "trailing slash"],
  ])("sends no credentials anywhere but AWS for %s (%s)", async (region) => {
    await refreshKiroToken(`rt-${region}`, { ...base, region }, null).catch(() => null);

    const offsite = fetchMock.mock.calls
      .map(([url]) => new URL(url).hostname)
      .filter((h) => h !== "amazonaws.com" && !h.endsWith(".amazonaws.com"));
    expect(offsite).toEqual([]);
  });

  it("still refreshes over a well-formed region", async () => {
    const out = await refreshKiroToken("rt-ok", { ...base, region: "eu-west-2" }, null);

    expect(fetchMock.mock.calls[0][0]).toBe("https://oidc.eu-west-2.amazonaws.com/token");
    expect(out?.accessToken).toBe("at");
  });
});
