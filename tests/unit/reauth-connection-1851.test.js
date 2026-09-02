/**
 * #1851 — re-authenticating an account must update the row that already exists.
 *
 * Before this, an expired account could only be fixed by deleting it and adding
 * it again, which threw away its id, its place in the fallback order, its proxy
 * binding and its metadata. These tests pin that the credential is the only thing
 * that changes, and that a bad payload is refused rather than written.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/oauth/providers", () => ({
  getProvider: vi.fn(),
  generateAuthData: vi.fn(),
  exchangeTokens: vi.fn(),
  requestDeviceCode: vi.fn(),
  pollForToken: vi.fn(),
  extractCodexAccountInfo: vi.fn(() => ({})),
}));
vi.mock("@/lib/oauth/utils/server", () => Object.fromEntries(
  ["Codex", "Xai", "Trae", "Windsurf", "Zed", "Devin"].flatMap((p) => [
    [`start${p}Proxy`, vi.fn()],
    [`stop${p}Proxy`, vi.fn()],
    [`register${p}Session`, vi.fn()],
    [`get${p}SessionStatus`, vi.fn()],
    [`clear${p}Session`, vi.fn()],
  ])
));
vi.mock("@/lib/oauth/utils/ideDetect", () => ({ detectIdeInstalled: vi.fn() }));
vi.mock("@/lib/oauth/constants/oauth", () => ({ ZED_HOSTED_CONFIG: {} }));

const originalDataDir = process.env.DATA_DIR;
let dataDir;
let repo;
let models;
let oauthPost;
let oauthProviders;

function oauthRequest(payload) {
  return new Request("http://localhost/api/oauth/qwen/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function seedConnection(overrides = {}) {
  return models.createProviderConnection({
    provider: "qwen",
    authType: "oauth",
    name: "Work account",
    email: "work@example.test",
    accessToken: "old-access",
    refreshToken: "old-refresh",
    defaultModel: "qwen3-max",
    providerSpecificData: { proxyPoolId: "pool-a", strictProxy: true, keep: "me" },
    ...overrides,
  });
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "tokenproxy-reauth-1851-"));
  process.env.DATA_DIR = dataDir;
  repo = await import("../../src/lib/db/repos/connectionsRepo.js");
  models = await import("../../src/models/index.js");
  oauthProviders = await import("../../src/lib/oauth/providers");
  ({ POST: oauthPost } = await import("../../src/app/api/oauth/[provider]/[action]/route.js"));
});

afterAll(() => {
  delete global._dbAdapter;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(async () => {
  vi.clearAllMocks();
  for (const conn of await models.getProviderConnections()) {
    await models.deleteProviderConnection(conn.id);
  }
});

describe("reauthorizeProviderConnection", () => {
  it("replaces the credential and keeps everything else", async () => {
    const before = await seedConnection();

    const outcome = await repo.reauthorizeProviderConnection(before.id, {
      provider: "qwen",
      accessToken: "new-access",
      refreshToken: "new-refresh",
      email: "work@example.test",
      providerSpecificData: { resourceUrl: "portal.example.test" },
    });

    expect(outcome.ok).toBe(true);
    const after = await models.getProviderConnectionById(before.id);
    expect(after.id).toBe(before.id);
    expect(after.priority).toBe(before.priority);
    expect(after.name).toBe("Work account");
    expect(after.defaultModel).toBe("qwen3-max");
    expect(after.accessToken).toBe("new-access");
    expect(after.refreshToken).toBe("new-refresh");
    // The proxy binding and any other provider metadata survive the sign-in.
    expect(after.providerSpecificData).toMatchObject({
      proxyPoolId: "pool-a",
      strictProxy: true,
      keep: "me",
      resourceUrl: "portal.example.test",
    });
  });

  it("never lets a sign-in payload rewrite the proxy binding", async () => {
    const before = await seedConnection();

    await repo.reauthorizeProviderConnection(before.id, {
      accessToken: "new-access",
      providerSpecificData: { proxyPoolId: "attacker-pool", strictProxy: false },
    });

    const after = await models.getProviderConnectionById(before.id);
    expect(after.providerSpecificData.proxyPoolId).toBe("pool-a");
    expect(after.providerSpecificData.strictProxy).toBe(true);
  });

  it("refuses a payload with no usable credential and keeps the working one", async () => {
    const before = await seedConnection();

    const outcome = await repo.reauthorizeProviderConnection(before.id, {
      accessToken: null,
      refreshToken: undefined,
      email: "work@example.test",
    });

    expect(outcome).toEqual({ ok: false, code: "empty_credential" });
    const after = await models.getProviderConnectionById(before.id);
    expect(after.accessToken).toBe("old-access");
    expect(after.refreshToken).toBe("old-refresh");
  });

  it("refuses a credential from a different provider", async () => {
    const before = await seedConnection();

    const outcome = await repo.reauthorizeProviderConnection(before.id, {
      provider: "codex",
      accessToken: "codex-access",
    });

    expect(outcome).toEqual({ ok: false, code: "provider_mismatch" });
    expect((await models.getProviderConnectionById(before.id)).accessToken).toBe("old-access");
  });

  it("refuses a visibly different account unless forced", async () => {
    const before = await seedConnection();

    const refused = await repo.reauthorizeProviderConnection(before.id, {
      accessToken: "new-access",
      email: "someone-else@example.test",
    });
    expect(refused).toEqual({ ok: false, code: "identity_mismatch" });
    expect((await models.getProviderConnectionById(before.id)).accessToken).toBe("old-access");

    const forced = await repo.reauthorizeProviderConnection(before.id, {
      accessToken: "new-access",
      email: "someone-else@example.test",
      force: true,
    });
    expect(forced.ok).toBe(true);
    const after = await models.getProviderConnectionById(before.id);
    expect(after.email).toBe("someone-else@example.test");
    expect(after.accessToken).toBe("new-access");
  });

  it("clears the failure state recorded against the credential that just died", async () => {
    const before = await seedConnection();
    await models.updateProviderConnection(before.id, {
      testStatus: "error",
      isActive: false,
      lastError: "invalid_grant",
      errorCode: "401",
      backoffLevel: 3,
      rateLimitedUntil: new Date(Date.now() + 3600_000).toISOString(),
      modelLock_qwen3max: "locked",
      modelFailure_qwen3max: 4,
    });

    await repo.reauthorizeProviderConnection(before.id, { accessToken: "new-access" });

    const after = await models.getProviderConnectionById(before.id);
    expect(after.testStatus).toBe("active");
    expect(after.isActive).toBe(true);
    for (const gone of ["lastError", "errorCode", "backoffLevel", "rateLimitedUntil", "modelLock_qwen3max", "modelFailure_qwen3max"]) {
      expect(after[gone]).toBeUndefined();
    }
  });

  // clearReauthFailureState was factored out of the codex email-match merge so the
  // generic path could reuse it; that merge must keep behaving identically.
  it("still clears failure state on the codex re-login that merges by account id", async () => {
    const first = await models.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "codex@example.test",
      accessToken: "old-access",
      providerSpecificData: { chatgptAccountId: "acct-1" },
    });
    await models.updateProviderConnection(first.id, {
      testStatus: "error", isActive: false, lastError: "invalid_grant",
      errorCode: "401", backoffLevel: 2, modelLock_gpt5: "locked",
    });

    const merged = await models.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "codex@example.test",
      accessToken: "new-access",
      providerSpecificData: { chatgptAccountId: "acct-1" },
    });

    expect(merged.id).toBe(first.id);
    expect(await models.getProviderConnections({ provider: "codex" })).toHaveLength(1);
    const after = await models.getProviderConnectionById(first.id);
    expect(after.accessToken).toBe("new-access");
    expect(after.testStatus).toBe("active");
    expect(after.isActive).toBe(true);
    for (const gone of ["lastError", "errorCode", "backoffLevel", "modelLock_gpt5"]) {
      expect(after[gone]).toBeUndefined();
    }
  });

  it("reports a missing target instead of creating one", async () => {
    const outcome = await repo.reauthorizeProviderConnection("no-such-id", { accessToken: "x" });
    expect(outcome).toEqual({ ok: false, code: "not_found" });
    expect(await models.getProviderConnections()).toHaveLength(0);
  });

  it("leaves the fallback order of the whole provider untouched", async () => {
    const first = await seedConnection({ name: "One", email: "one@example.test" });
    const second = await seedConnection({ name: "Two", email: "two@example.test" });
    const third = await seedConnection({ name: "Three", email: "three@example.test" });
    const orderBefore = (await models.getProviderConnections({ provider: "qwen" })).map((c) => c.id);

    await repo.reauthorizeProviderConnection(second.id, { accessToken: "new-access" });

    const orderAfter = (await models.getProviderConnections({ provider: "qwen" })).map((c) => c.id);
    expect(orderAfter).toEqual(orderBefore);
    expect(orderAfter).toEqual([first.id, second.id, third.id]);
  });
});

describe("OAuth completion routed at an existing connection", () => {
  it("updates the named row instead of adding a second account", async () => {
    const before = await seedConnection();
    oauthProviders.exchangeTokens.mockResolvedValue({
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
      expiresIn: 3600,
      email: "work@example.test",
    });

    const response = await oauthPost(
      oauthRequest({
        code: "auth-code",
        redirectUri: "http://localhost:8080/callback",
        codeVerifier: "verifier",
        reauthConnectionId: before.id,
      }),
      { params: Promise.resolve({ provider: "qwen", action: "exchange" }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.connection.id).toBe(before.id);
    expect(await models.getProviderConnections({ provider: "qwen" })).toHaveLength(1);
    const after = await models.getProviderConnectionById(before.id);
    expect(after.accessToken).toBe("fresh-access");
    expect(after.priority).toBe(before.priority);
    expect(after.providerSpecificData.proxyPoolId).toBe("pool-a");
  });

  it("carries the same target through the device-code poll", async () => {
    const before = await seedConnection();
    oauthProviders.pollForToken.mockResolvedValue({
      success: true,
      tokens: { accessToken: "polled-access", refreshToken: "polled-refresh", expiresIn: 3600 },
    });

    const response = await oauthPost(
      new Request("http://localhost/api/oauth/qwen/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCode: "dev", codeVerifier: "v", reauthConnectionId: before.id }),
      }),
      { params: Promise.resolve({ provider: "qwen", action: "poll" }) }
    );

    expect(response.status).toBe(200);
    expect(await models.getProviderConnections({ provider: "qwen" })).toHaveLength(1);
    expect((await models.getProviderConnectionById(before.id)).accessToken).toBe("polled-access");
  });

  it("surfaces a refused re-auth as a status rather than a new row", async () => {
    const before = await seedConnection();
    oauthProviders.exchangeTokens.mockResolvedValue({
      accessToken: "fresh-access",
      email: "different@example.test",
    });

    const response = await oauthPost(
      oauthRequest({
        code: "auth-code",
        redirectUri: "http://localhost:8080/callback",
        codeVerifier: "verifier",
        reauthConnectionId: before.id,
      }),
      { params: Promise.resolve({ provider: "qwen", action: "exchange" }) }
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("fresh-access");
    expect(await models.getProviderConnections({ provider: "qwen" })).toHaveLength(1);
    expect((await models.getProviderConnectionById(before.id)).accessToken).toBe("old-access");
  });

  it("still adds an account when no target is named", async () => {
    await seedConnection();
    oauthProviders.exchangeTokens.mockResolvedValue({
      accessToken: "fresh-access",
      email: "second@example.test",
    });

    const response = await oauthPost(
      oauthRequest({ code: "auth-code", redirectUri: "http://localhost:8080/callback", codeVerifier: "verifier" }),
      { params: Promise.resolve({ provider: "qwen", action: "exchange" }) }
    );

    expect(response.status).toBe(200);
    expect(await models.getProviderConnections({ provider: "qwen" })).toHaveLength(2);
  });
});

describe("POST /api/providers/[id]/reauth", () => {
  let reauthPost;

  beforeAll(async () => {
    ({ POST: reauthPost } = await import("../../src/app/api/providers/[id]/reauth/route.js"));
  });

  function reauthRequest(id, payload) {
    return new Request(`http://localhost/api/providers/${id}/reauth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  it("applies an exported account file to the existing connection", async () => {
    const before = await seedConnection({ provider: "codex", email: "codex@example.test" });

    const response = await reauthPost(
      reauthRequest(before.id, {
        version: 1,
        accounts: [{
          provider: "codex",
          authType: "oauth",
          email: "codex@example.test",
          accessToken: "imported-access",
          refreshToken: "imported-refresh",
          expiresIn: 3600,
        }],
      }),
      { params: Promise.resolve({ id: before.id }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.connection.id).toBe(before.id);
    expect(JSON.stringify(body)).not.toContain("imported-access");
    const after = await models.getProviderConnectionById(before.id);
    expect(after.accessToken).toBe("imported-access");
    expect(after.expiresAt).toBeTruthy();
    expect(after.providerSpecificData.proxyPoolId).toBe("pool-a");
  });

  it("refuses a malformed file before it can blank a working credential", async () => {
    const before = await seedConnection();

    for (const payload of [{}, { accessToken: "" }, { accessToken: "   " }, { accounts: [] }, { accessToken: 12 }]) {
      const response = await reauthPost(reauthRequest(before.id, payload), {
        params: Promise.resolve({ id: before.id }),
      });
      expect(response.status).toBe(400);
    }

    const after = await models.getProviderConnectionById(before.id);
    expect(after.accessToken).toBe("old-access");
    expect(after.refreshToken).toBe("old-refresh");
  });

  it("refuses a codex file dropped on another provider's account", async () => {
    const before = await seedConnection();

    const response = await reauthPost(
      reauthRequest(before.id, { provider: "codex", accessToken: "codex-access" }),
      { params: Promise.resolve({ id: before.id }) }
    );

    expect(response.status).toBe(400);
    expect((await models.getProviderConnectionById(before.id)).accessToken).toBe("old-access");
  });
});
