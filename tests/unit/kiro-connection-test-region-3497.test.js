import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// PR #3497. A saved Kiro connection carries its own `region`, which the connection
// test interpolates straight into `https://oidc.${region}.amazonaws.com/token` and
// then POSTs clientId, clientSecret and refreshToken to. A region imported from a
// hostile config ("evil.example.com/") moves the host off AWS and hands those
// credentials to whoever owns it. Every other Kiro region sink already fails closed
// through assertValidAwsRegion; this was the last one, and Issue CLAIM I-014 owned
// it until 9b7203e10 released the path.
const AWS_HOST = /^https:\/\/oidc\.[a-z]{2}-[a-z]+-\d{1,2}\.amazonaws\.com\//;

function kiroConnection(region) {
  return {
    id: "conn_kiro",
    provider: "kiro",
    authType: "oauth",
    accessToken: "expired-access-token",
    refreshToken: "kiro-refresh-token",
    // Already past its lead window, so the test refreshes before probing.
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
    providerSpecificData: {
      clientId: "kiro-client-id",
      clientSecret: "kiro-client-secret",
      region,
    },
  };
}

async function runConnectionTest(region) {
  const fetched = [];
  vi.doMock("@/lib/localDb", () => ({
    getProviderConnectionById: vi.fn(async () => kiroConnection(region)),
    updateProviderConnection: vi.fn(async () => ({})),
  }));
  vi.doMock("@/lib/network/connectionProxy", () => ({
    resolveConnectionProxyConfig: vi.fn(async () => ({ kind: "none" })),
    toConnectionProxyOptions: vi.fn(() => ({})),
  }));
  vi.doMock("open-sse/utils/proxyFetch.js", () => ({
    proxyAwareFetch: vi.fn(async (url) => {
      fetched.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 3600 }),
        text: async () => "{}",
      };
    }),
  }));

  const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
  const result = await testSingleConnection("conn_kiro");
  return { result, fetched };
}

describe("Kiro connection-test region is validated before credentialed egress (#3497)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.doUnmock("@/lib/localDb");
    vi.doUnmock("@/lib/network/connectionProxy");
    vi.doUnmock("open-sse/utils/proxyFetch.js");
  });

  it("makes zero requests when the saved region is not an AWS region", async () => {
    const { result, fetched } = await runConnectionTest("evil.example.com/");

    expect(fetched).toEqual([]);
    expect(result.valid).toBe(false);
  });

  it("rejects a region carrying a path separator that re-hosts the token endpoint", async () => {
    const { fetched } = await runConnectionTest("us-east-1.attacker.example.com");

    expect(fetched.filter((u) => !AWS_HOST.test(u))).toEqual([]);
  });

  it("leaves the social refresh path, which reads no region, working", async () => {
    // No clientId/clientSecret means the credentialed OIDC branch is never taken,
    // so a junk region on such a connection must not fail its refresh closed.
    const fetched = [];
    vi.doMock("@/lib/localDb", () => ({
      getProviderConnectionById: vi.fn(async () => {
        const c = kiroConnection("evil.example.com/");
        delete c.providerSpecificData.clientId;
        delete c.providerSpecificData.clientSecret;
        return c;
      }),
      updateProviderConnection: vi.fn(async () => ({})),
    }));
    vi.doMock("@/lib/network/connectionProxy", () => ({
      resolveConnectionProxyConfig: vi.fn(async () => ({ kind: "none" })),
      toConnectionProxyOptions: vi.fn(() => ({})),
    }));
    vi.doMock("open-sse/utils/proxyFetch.js", () => ({
      proxyAwareFetch: vi.fn(async (url) => {
        fetched.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: "new-access", expiresIn: 3600 }),
          text: async () => "{}",
        };
      }),
    }));

    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
    const result = await testSingleConnection("conn_kiro");

    expect(fetched).toHaveLength(1);
    expect(fetched[0]).not.toContain("evil.example.com");
    expect(result.valid).toBe(true);
  });

  it("still refreshes through the real endpoint for a valid region", async () => {
    const { result, fetched } = await runConnectionTest("eu-central-1");

    expect(fetched).toEqual(["https://oidc.eu-central-1.amazonaws.com/token"]);
    expect(result.valid).toBe(true);
  });
});
