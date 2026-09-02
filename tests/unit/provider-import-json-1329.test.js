// Issue #1329: per-provider importers already exist (codex bulk-import, cursor
// import, kiro cli-proxy, gitlab pat), but each is wired to one provider, so
// moving a set of accounts between machines meant knowing which route each
// account needed. This is the provider-agnostic one. The body is credentials,
// so what it accepts is exactly what the connection layer owns and no more.
import { describe, expect, it, vi, beforeEach } from "vitest";

const created = [];
vi.mock("@/models", () => ({
  createProviderConnection: vi.fn(async (data) => {
    if (data.accessToken === "explode") throw new Error("write failed");
    created.push(data);
    return { id: `id-${created.length}`, provider: data.provider };
  }),
}));

const { POST, normalizeImportItem } = await import("@/app/api/providers/import/route.js");

const req = (body) => ({ json: async () => body });
const CODEX = {
  provider: "codex",
  authType: "oauth",
  email: "user@example.com",
  accessToken: "sk-access-9f2c",
  refreshToken: "sk-refresh-4b71",
  providerSpecificData: { chatgptAccountId: "ws-1", chatgptPlanType: "plus" },
};

beforeEach(() => { created.length = 0; });

describe("what the importer accepts (#1329)", () => {
  it("takes the single object from the report verbatim", async () => {
    const res = await POST(req(CODEX));
    expect(await res.json()).toMatchObject({ success: 1, failed: 0 });
    expect(created[0]).toMatchObject({ provider: "codex", authType: "oauth", accessToken: "sk-access-9f2c" });
  });

  it("takes an array", async () => {
    const res = await POST(req([CODEX, { ...CODEX, email: "b@example.com" }]));
    expect(await res.json()).toMatchObject({ success: 2, failed: 0 });
  });

  it("takes a wrapped { accounts: [...] }", async () => {
    await POST(req({ accounts: [CODEX] }));
    expect(created).toHaveLength(1);
  });

  it("takes a database export shaped { providerConnections: [...] }", async () => {
    await POST(req({ providerConnections: [CODEX] }));
    expect(created).toHaveLength(1);
  });

  it("refuses a body that carries nothing", async () => {
    const res = await POST(req([]));
    expect(res.status).toBe(400);
  });
});

describe("what it refuses to write (#1329)", () => {
  it("refuses an unknown provider rather than creating a dead row", () => {
    expect(() => normalizeImportItem({ ...CODEX, provider: "not-a-provider" })).toThrow(/Unknown provider/);
  });

  it("refuses an unknown authType instead of coercing one", () => {
    expect(() => normalizeImportItem({ ...CODEX, authType: "magic" })).toThrow(/Unknown authType/);
  });

  it("refuses an item with no credential at all", () => {
    const { accessToken, refreshToken, ...bare } = CODEX;
    expect(() => normalizeImportItem(bare)).toThrow(/No credential/);
  });

  it("drops server-owned fields instead of letting the body set them", () => {
    const item = normalizeImportItem({ ...CODEX, id: "forged", createdAt: "then", updatedAt: "then" });
    expect(item.id).toBeUndefined();
    expect(item.createdAt).toBeUndefined();
    expect(item.updatedAt).toBeUndefined();
  });

  it("drops a field the connection layer does not own", () => {
    const item = normalizeImportItem({ ...CODEX, rateLimitedUntil: "2030-01-01", somethingElse: 1 });
    expect(item.rateLimitedUntil).toBeUndefined();
    expect(item.somethingElse).toBeUndefined();
  });

  it("refuses providerSpecificData that is not an object", () => {
    expect(() => normalizeImportItem({ ...CODEX, providerSpecificData: "nope" })).toThrow(/not an object/);
  });
});

describe("normalization (#1329)", () => {
  it("accepts api_key as the apikey spelling some exports carry", () => {
    expect(normalizeImportItem({ provider: "openai", authType: "api_key", apiKey: "k" }).authType).toBe("apikey");
  });

  it("computes expiresAt from expiresIn when only that is present", () => {
    const item = normalizeImportItem({ ...CODEX, expiresIn: 3600 });
    expect(Date.parse(item.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("keeps an expiresAt the export already carried", () => {
    const item = normalizeImportItem({ ...CODEX, expiresAt: "2030-01-01T00:00:00.000Z", expiresIn: 3600 });
    expect(item.expiresAt).toBe("2030-01-01T00:00:00.000Z");
  });

  it("defaults to an active connection, as the login flow leaves one", () => {
    const item = normalizeImportItem(CODEX);
    expect(item.isActive).toBe(true);
    expect(item.testStatus).toBe("active");
  });

  it("keeps an explicit isActive false", () => {
    expect(normalizeImportItem({ ...CODEX, isActive: false }).isActive).toBe(false);
  });
});

describe("reporting (#1329)", () => {
  it("reports per-item outcomes and never echoes a token", async () => {
    const res = await POST(req([CODEX, { provider: "nope", authType: "oauth", accessToken: "x" }]));
    const json = await res.json();
    expect(json).toMatchObject({ success: 1, failed: 1 });
    expect(json.results[1]).toMatchObject({ index: 1, ok: false });
    const flat = JSON.stringify(json);
    expect(flat).not.toContain(CODEX.accessToken);
    expect(flat).not.toContain(CODEX.refreshToken);
    expect(flat).not.toContain(CODEX.email);
  });

  it("one failing write does not abandon the rest", async () => {
    const res = await POST(req([{ ...CODEX, accessToken: "explode" }, CODEX]));
    expect(await res.json()).toMatchObject({ success: 1, failed: 1 });
  });
});
