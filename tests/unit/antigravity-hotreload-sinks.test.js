import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  getHotReloadConfig: vi.fn(),
  refreshAndUpdateCredentials: vi.fn(),
}));

vi.mock("@/lib/db/index.js", () => ({ getProviderConnectionById: mocks.getProviderConnectionById }));
vi.mock("@/shared/constants/config", () => ({ getHotReloadConfig: mocks.getHotReloadConfig }));
vi.mock("@/app/api/usage/[connectionId]/route", () => ({ refreshAndUpdateCredentials: mocks.refreshAndUpdateCredentials }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn() }));
vi.mock("open-sse/services/usage.js", () => ({ getUsageForProvider: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
vi.mock("@/lib/antigravityVerification", () => ({
  createAntigravityVerificationHooks: vi.fn(),
  runAntigravityUsageProbe: vi.fn(),
}));

const { POST } = await import("../../src/app/api/providers/[id]/hotreload/route.js");

describe("Antigravity hot-reload diagnostic sink", () => {
  it("does not expose an opaque refresh diagnostic", async () => {
    const opaque = "opaque-hotreload-refresh-secret";
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-hot", provider: "antigravity", authType: "oauth", providerSpecificData: {},
    });
    mocks.getHotReloadConfig.mockReturnValue({ models: ["gemini-3.7-flash"] });
    mocks.refreshAndUpdateCredentials.mockRejectedValueOnce(new Error(opaque));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await POST(new Request("http://localhost:20128/api/providers/conn-hot/hotreload", { method: "POST" }), {
      params: Promise.resolve({ id: "conn-hot" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({ ok: false, error: "Antigravity upstream request failed", connectionId: "conn-hot" });
    expect(JSON.stringify([payload, warn.mock.calls])).not.toContain(opaque);
  });
});
