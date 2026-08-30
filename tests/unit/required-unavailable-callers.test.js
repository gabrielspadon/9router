import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  getDailyConnectionUsage: vi.fn(),
  getUsageForProvider: vi.fn(),
  getCodexRateLimitResetCredits: vi.fn(),
  consumeCodexRateLimitResetCredit: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  refreshAndUpdateCredentials: vi.fn(),
  getExecutor: vi.fn(),
  getSettings: vi.fn(),
  getProviderConnections: vi.fn(),
  getClaudeUsage: vi.fn(),
  getCodexUsage: vi.fn(),
  proxyAwareFetch: vi.fn(),
  testProxyUrl: vi.fn(),
  getHotReloadConfig: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
  getDailyConnectionUsage: mocks.getDailyConnectionUsage,
  getSettings: mocks.getSettings,
  getProviderConnections: mocks.getProviderConnections,
}));

vi.mock("@/lib/db/index.js", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: mocks.testProxyUrl,
}));

vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider: mocks.getUsageForProvider,
  getCodexRateLimitResetCredits: mocks.getCodexRateLimitResetCredits,
  consumeCodexRateLimitResetCredit: mocks.consumeCodexRateLimitResetCredit,
}));

vi.mock("open-sse/services/usage/claude.js", () => ({ getClaudeUsage: mocks.getClaudeUsage }));
vi.mock("open-sse/services/usage/codex.js", () => ({ getCodexUsage: mocks.getCodexUsage }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: mocks.getExecutor }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.proxyAwareFetch }));

vi.mock("@/app/api/usage/[connectionId]/route.js", async (importOriginal) => ({
  ...(await importOriginal()),
  refreshAndUpdateCredentials: mocks.refreshAndUpdateCredentials,
}));

vi.mock("@/shared/constants/config", async (importOriginal) => ({
  ...(await importOriginal()),
  getHotReloadConfig: mocks.getHotReloadConfig,
}));

const requiredUnavailable = {
  kind: "required-unavailable",
  resolutionKind: "required-unavailable",
  reason: "selected-pool-unavailable",
  strictProxy: true,
};

const connection = {
  id: "conn-required-proxy",
  provider: "codex",
  authType: "oauth",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  providerSpecificData: { proxyPoolId: "missing-pool", strictProxy: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveConnectionProxyConfig.mockResolvedValue(requiredUnavailable);
  mocks.getProviderConnectionById.mockResolvedValue(connection);
  mocks.refreshAndUpdateCredentials.mockResolvedValue({ connection });
  mocks.getHotReloadConfig.mockReturnValue({ models: ["model-required-proxy"] });
  mocks.getExecutor.mockReturnValue({ needsRefresh: () => false });
});

describe("required proxy unavailable caller boundaries", () => {
  it.each([null, {
    windows: [{ key: "session", remainingPercentage: 90, unlimited: false }],
    fetchedAt: new Date().toISOString(),
  }])("quota guard returns its no-live typed result before usage %#", async (lastQuotaSnapshot) => {
    const { evaluateQuota } = await import("@/sse/services/quotaGuard.js");
    const result = await evaluateQuota({
      ...connection,
      quotaPauseThresholds: { session: 10 },
      lastQuotaSnapshot,
    });

    expect(result).toMatchObject({
      paused: false,
      reason: "required-proxy-unavailable",
      code: "required_proxy_unavailable",
    });
    expect(mocks.getUsageForProvider).not.toHaveBeenCalled();
  });

  it("auto ping skips unavailable selection before refresh or usage", async () => {
    const { runQuotaAutoPingTick } = await import("@/shared/services/quotaAutoPing.js");
    const deps = {
      getSettings: vi.fn().mockResolvedValue({ codexAutoPing: { connections: { [connection.id]: true } } }),
      getProviderConnections: vi.fn().mockResolvedValue([connection]),
      updateProviderConnection: vi.fn(),
      resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
      refreshAndUpdateCredentials: mocks.refreshAndUpdateCredentials,
      proxyAwareFetch: mocks.proxyAwareFetch,
      getExecutor: mocks.getExecutor,
    };
    const state = { running: false, resetCache: {}, failureCache: {} };

    await runQuotaAutoPingTick(deps, state);

    expect(mocks.refreshAndUpdateCredentials).not.toHaveBeenCalled();
    expect(mocks.getCodexUsage).not.toHaveBeenCalled();
    expect(mocks.getExecutor).not.toHaveBeenCalled();
  });

  it("usage route returns 503 before credential refresh or usage", async () => {
    const { GET } = await import("@/app/api/usage/[connectionId]/route.js");
    const response = await GET(new Request("http://localhost/api/usage/conn-required-proxy"), {
      params: Promise.resolve({ connectionId: connection.id }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Required proxy is unavailable",
      code: "required_proxy_unavailable",
    });
    expect(mocks.getExecutor).not.toHaveBeenCalled();
    expect(mocks.getUsageForProvider).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", "getCodexRateLimitResetCredits"],
    ["POST", "consumeCodexRateLimitResetCredit"],
  ])("Codex reset %s returns 503 before refresh or reset-credit egress", async (method, forbidden) => {
    const route = await import("@/app/api/usage/[connectionId]/codex-reset-credits/route.js");
    const response = await route[method](new Request("http://localhost/api/usage/conn-required-proxy/codex-reset-credits", { method }), {
      params: Promise.resolve({ connectionId: connection.id }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Required proxy is unavailable",
      code: "required_proxy_unavailable",
    });
    expect(mocks.refreshAndUpdateCredentials).not.toHaveBeenCalled();
    expect(mocks[forbidden]).not.toHaveBeenCalled();
  });

  it("hot reload returns 503 before credential refresh or poke", async () => {
    const { POST } = await import("@/app/api/providers/[id]/hotreload/route.js");
    const response = await POST(new Request("http://localhost/api/providers/conn-required-proxy/hotreload", { method: "POST" }), {
      params: Promise.resolve({ id: connection.id }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "Required proxy is unavailable",
      code: "required_proxy_unavailable",
    });
    expect(mocks.refreshAndUpdateCredentials).not.toHaveBeenCalled();
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("provider test returns its typed failed-test shape before proxy testing", async () => {
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      ...requiredUnavailable,
      connectionProxyEnabled: true,
      connectionProxyUrl: "https://proxy.test:8443",
    });
    mocks.testProxyUrl.mockResolvedValue({ ok: false, error: "must not run" });
    const { testSingleConnection } = await import("@/app/api/providers/[id]/test/testUtils.js");
    const result = await testSingleConnection(connection.id);

    expect(result).toMatchObject({
      valid: false,
      error: "Required proxy is unavailable",
      code: "required_proxy_unavailable",
      status: 503,
      latencyMs: 0,
    });
    expect(mocks.testProxyUrl).not.toHaveBeenCalled();
  });
});
