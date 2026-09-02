/**
 * #1590 — import/export one Codex account.
 *
 * The import half was already served: /api/oauth/codex/bulk-import accepts a bare
 * single object as well as an array, so a per-account import needs no second
 * parser. What was missing is the export, and an export hands out a refresh
 * token, so most of what is pinned here is the gate around it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const guard = vi.hoisted(() => ({ cliToken: false, local: false, jwtValid: false }));

vi.mock("@/dashboardGuard", () => ({
  hasValidCliToken: vi.fn(async () => guard.cliToken),
  isLocalRequest: vi.fn(() => guard.local),
}));
vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: vi.fn(async () => guard.jwtValid),
}));
vi.mock("@/lib/oauth/providers", () => ({
  extractCodexAccountInfo: vi.fn(() => ({})),
}));

const originalDataDir = process.env.DATA_DIR;
let dataDir;
let models;
let exportPost;
let bulkImportPost;

function exportRequest(payload, { jwt = null } = {}) {
  const request = new Request("http://localhost/api/oauth/codex/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  request.cookies = { get: (name) => (name === "auth_token" && jwt ? { value: jwt } : undefined) };
  return request;
}

function importRequest(payload) {
  return new Request("http://localhost/api/oauth/codex/bulk-import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function seedCodexAccount(overrides = {}) {
  return models.createProviderConnection({
    provider: "codex",
    authType: "oauth",
    name: "Codex work",
    email: "codex@example.test",
    accessToken: "access-abc",
    refreshToken: "refresh-abc",
    idToken: "id-abc",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    providerSpecificData: {
      chatgptAccountId: "acct-1",
      chatgptPlanType: "plus",
      proxyPoolId: "pool-a",
      strictProxy: true,
    },
    ...overrides,
  });
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "tokenproxy-codex-export-1590-"));
  process.env.DATA_DIR = dataDir;
  models = await import("../../src/models/index.js");
  ({ POST: exportPost } = await import("../../src/app/api/oauth/codex/export/route.js"));
  ({ POST: bulkImportPost } = await import("../../src/app/api/oauth/codex/bulk-import/route.js"));
});

afterAll(() => {
  delete global._dbAdapter;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(async () => {
  vi.clearAllMocks();
  guard.cliToken = false;
  guard.local = false;
  guard.jwtValid = false;
  for (const conn of await models.getProviderConnections()) {
    await models.deleteProviderConnection(conn.id);
  }
});

describe("credential egress gate", () => {
  it("refuses a remote caller", async () => {
    const account = await seedCodexAccount();
    const response = await exportPost(exportRequest({ connectionId: account.id }));
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("refresh-abc");
  });

  it("refuses a loopback caller with no signed-in session, even though /api/oauth allows requireLogin=false", async () => {
    const account = await seedCodexAccount();
    guard.local = true;
    const response = await exportPost(exportRequest({ connectionId: account.id }));
    expect(response.status).toBe(403);
  });

  it("refuses a loopback caller whose session cookie does not verify", async () => {
    const account = await seedCodexAccount();
    guard.local = true;
    guard.jwtValid = false;
    const response = await exportPost(exportRequest({ connectionId: account.id }, { jwt: "stale" }));
    expect(response.status).toBe(403);
  });

  it("allows the CLI token, and a signed-in session on the loopback socket", async () => {
    const account = await seedCodexAccount();

    guard.cliToken = true;
    expect((await exportPost(exportRequest({ connectionId: account.id }))).status).toBe(200);

    guard.cliToken = false;
    guard.local = true;
    guard.jwtValid = true;
    expect((await exportPost(exportRequest({ connectionId: account.id }, { jwt: "good" }))).status).toBe(200);
  });
});

describe("exported account", () => {
  beforeEach(() => { guard.cliToken = true; });

  it("is never cached and never leaks through a referrer", async () => {
    const account = await seedCodexAccount();
    const response = await exportPost(exportRequest({ connectionId: account.id }));
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("carries the credential and the account identity, but not the install's proxy binding", async () => {
    const account = await seedCodexAccount();
    const payload = await (await exportPost(exportRequest({ connectionId: account.id }))).json();

    expect(payload.accounts).toHaveLength(1);
    const exported = payload.accounts[0];
    expect(exported.accessToken).toBe("access-abc");
    expect(exported.refreshToken).toBe("refresh-abc");
    expect(exported.email).toBe("codex@example.test");
    expect(exported.providerSpecificData.chatgptAccountId).toBe("acct-1");
    // A pool id names nothing on the machine importing it.
    expect(exported.providerSpecificData.proxyPoolId).toBeUndefined();
    expect(exported.providerSpecificData.strictProxy).toBeUndefined();
    // Row identity belongs to this install, not to the account.
    expect(exported.id).toBeUndefined();
  });

  it("rejects a connection that is not a Codex account, and one holding no credential", async () => {
    const other = await models.createProviderConnection({
      provider: "qwen", authType: "oauth", accessToken: "qwen-access",
    });
    expect((await exportPost(exportRequest({ connectionId: other.id }))).status).toBe(400);

    const empty = await models.createProviderConnection({
      provider: "codex", authType: "oauth", name: "Empty",
    });
    expect((await exportPost(exportRequest({ connectionId: empty.id }))).status).toBe(409);

    expect((await exportPost(exportRequest({ connectionId: "nope" }))).status).toBe(404);
    expect((await exportPost(exportRequest({}))).status).toBe(400);
  });
});

describe("round trip through the existing importer", () => {
  it("re-imports an exported account as one account, with its auth type intact", async () => {
    guard.cliToken = true;
    const account = await seedCodexAccount({ authType: "access_token", refreshToken: undefined });
    const payload = await (await exportPost(exportRequest({ connectionId: account.id }))).json();
    await models.deleteProviderConnection(account.id);

    const response = await bulkImportPost(importRequest(payload));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: 1, failed: 0 });

    const [restored] = await models.getProviderConnections({ provider: "codex" });
    expect(restored.accessToken).toBe("access-abc");
    expect(restored.email).toBe("codex@example.test");
    // Coercing this to "oauth" produced a row the refresher could only fail on.
    expect(restored.authType).toBe("access_token");
  });

  it("imports one account from a bare object, so a per-account import needs no new route", async () => {
    const response = await bulkImportPost(importRequest({
      email: "single@example.test",
      accessToken: "single-access",
      refreshToken: "single-refresh",
    }));

    expect(await response.json()).toMatchObject({ success: 1, failed: 0 });
    const [imported] = await models.getProviderConnections({ provider: "codex" });
    expect(imported.email).toBe("single@example.test");
    expect(imported.authType).toBe("oauth");
  });

  it("reports a malformed account instead of writing an empty one", async () => {
    const response = await bulkImportPost(importRequest({ accounts: [{ email: "no-token@example.test" }] }));
    expect(await response.json()).toMatchObject({ success: 0, failed: 1 });
    expect(await models.getProviderConnections({ provider: "codex" })).toHaveLength(0);
  });
});
