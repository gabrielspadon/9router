// Issue #1386, second half: the auto router was routable but undiscoverable.
// It belongs to no provider, so it appeared in no listing and a client had to
// already know the string. It is advertised on the client-facing /v1/models
// response rather than inside buildModelsList, because that function is the
// catalogue every internal consumer reads — the router itself and the combo
// suggester among them — and none of those may see a virtual id.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { connectionsMock, claudeCompatMock } = vi.hoisted(() => ({
  connectionsMock: vi.fn(),
  claudeCompatMock: vi.fn(() => ({ enabled: false })),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: connectionsMock,
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getFreeModels: vi.fn(async () => ({})),
  getSettings: vi.fn(async () => ({})),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn(async () => {}) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(() => null) }));
vi.mock("@/models", () => ({ getProviderConnectionById: vi.fn(async () => null) }));
vi.mock("@/lib/claudeCompat", () => ({
  readClaudeCompat: claudeCompatMock,
  rewriteModelsListForClaude: vi.fn((models) => models.map((m) => ({ ...m, id: `claude-${m.id}` }))),
}));

const { GET, buildModelsList } = await import("@/app/api/v1/models/route.js");
const { AUTO_ROUTER_MODEL_ID, AUTO_MODEL_IDS } = await import("@/sse/services/autoRouter.js");

const CONNECTION = { provider: "openai", isActive: true, apiKey: "sk-test", authType: "apikey" };
const req = (headers = {}) => ({ headers: new Headers(headers) });
const listed = async (headers) => (await (await GET(req(headers))).json()).data.map((m) => m.id);

beforeEach(() => {
  vi.clearAllMocks();
  claudeCompatMock.mockReturnValue({ enabled: false });
  connectionsMock.mockResolvedValue([CONNECTION]);
});

describe("the auto router is discoverable (#1386)", () => {
  it("appears in the client-facing listing", async () => {
    expect(await listed()).toContain(AUTO_ROUTER_MODEL_ID);
  });

  it("is listed exactly once", async () => {
    expect((await listed()).filter((id) => id === AUTO_ROUTER_MODEL_ID)).toHaveLength(1);
  });

  it("is attributed to the router, not to a provider that does not own it", async () => {
    const data = (await (await GET(req())).json()).data;
    expect(data.find((m) => m.id === AUTO_ROUTER_MODEL_ID)).toMatchObject({
      object: "model", owned_by: "tokenproxy",
    });
  });

  it("is the id the router accepts", () => {
    expect(AUTO_MODEL_IDS.has(AUTO_ROUTER_MODEL_ID)).toBe(true);
  });
});

describe("where it must not appear (#1386)", () => {
  it("stays out of buildModelsList, which the router itself reads", async () => {
    // Listing it there would make the router a candidate for its own routing.
    const ids = (await buildModelsList(["llm"])).map((m) => m.id);
    expect(ids).not.toContain(AUTO_ROUTER_MODEL_ID);
  });

  it("is absent from an install with no connections", async () => {
    // Offering an id that answers 503 is worse than not offering it.
    connectionsMock.mockResolvedValue([]);
    expect(await listed()).not.toContain(AUTO_ROUTER_MODEL_ID);
  });

  it("is not offered to a Claude-compat client, in any spelling", async () => {
    // That client filters ids by /(claude|anthropic)/i and would drop it, and
    // the rewrite would turn it into a spelling the router does not accept.
    claudeCompatMock.mockReturnValue({ enabled: true });
    const ids = await listed({ "anthropic-version": "2023-06-01" });
    expect(ids).not.toContain(AUTO_ROUTER_MODEL_ID);
    expect(ids).not.toContain(`claude-${AUTO_ROUTER_MODEL_ID}`);
  });
});
