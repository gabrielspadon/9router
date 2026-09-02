// POST /api/oauth/grok-cli/bulk-import (upstream abb20d9f3).
//
// The Grok CLI twin of the codex bulk-import route. Everything it needs already
// existed here — decodeXaiIdTokenEmail, extractEmailFromAccessToken and
// createProviderConnection — so what is pinned is the wiring: what counts as an
// account, what a partial failure does, and that a token is never echoed back.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let dataDir;
let models;
let POST;

// A JWT is only ever decoded here, never verified, so an unsigned one is enough.
const jwt = (payload) =>
  `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

const post = (payload) =>
  POST(
    new Request("http://localhost/api/oauth/grok-cli/bulk-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    })
  );

const listGrok = async () =>
  (await models.getProviderConnections()).filter((c) => c.provider === "grok-cli");

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "tokenproxy-grok-bulk-import-"));
  process.env.DATA_DIR = dataDir;
  models = await import("../../src/models/index.js");
  ({ POST } = await import("../../src/app/api/oauth/grok-cli/bulk-import/route.js"));
});

afterAll(() => {
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const c of await listGrok()) await models.deleteProviderConnection(c.id);
});

describe("grok-cli bulk import — accepted shapes", () => {
  it("creates one connection per item in a bare array", async () => {
    const res = await post([
      { access_token: "at-1", refresh_token: "rt-1", email: "one@example.test" },
      { access_token: "at-2", refresh_token: "rt-2", email: "two@example.test" },
    ]);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toMatchObject({ success: 2, failed: 0 });
    expect(await listGrok()).toHaveLength(2);
  });

  it("accepts the { accounts: [...] } wrapper the modal posts", async () => {
    const res = await post({ accounts: [{ access_token: "at-3", email: "three@example.test" }] });
    expect((await res.json()).success).toBe(1);
    expect(await listGrok()).toHaveLength(1);
  });

  it("accepts a single bare object", async () => {
    const res = await post({ access_token: "at-4", email: "four@example.test" });
    expect((await res.json()).success).toBe(1);
    expect(await listGrok()).toHaveLength(1);
  });

  it("accepts camelCase token fields as well as snake_case", async () => {
    const res = await post([{ accessToken: "at-5", refreshToken: "rt-5", email: "five@example.test" }]);
    expect((await res.json()).success).toBe(1);
    const [conn] = await listGrok();
    expect(conn.accessToken).toBe("at-5");
    expect(conn.refreshToken).toBe("rt-5");
  });
});

describe("grok-cli bulk import — stored connection", () => {
  it("matches the device_code login flow", async () => {
    await post([{ access_token: "at-6", refresh_token: "rt-6", email: "six@example.test" }]);
    const [conn] = await listGrok();
    expect(conn.provider).toBe("grok-cli");
    expect(conn.authType).toBe("oauth");
    expect(conn.providerSpecificData.authMethod).toBe("device_code");
    expect(conn.testStatus).toBe("active");
    expect(conn.isActive).toBe(true);
  });

  it("backfills the email from the id_token", async () => {
    await post([{ access_token: "at-7", id_token: jwt({ email: "from-id@example.test" }) }]);
    const [conn] = await listGrok();
    expect(conn.email).toBe("from-id@example.test");
  });

  it("backfills the email from the access token when no id_token is given", async () => {
    await post([{ access_token: jwt({ email: "from-access@example.test" }) }]);
    const [conn] = await listGrok();
    expect(conn.email).toBe("from-access@example.test");
  });

  it("keeps an explicit email over anything decoded from a token", async () => {
    await post([{ access_token: jwt({ email: "decoded@example.test" }), email: "explicit@example.test" }]);
    const [conn] = await listGrok();
    expect(conn.email).toBe("explicit@example.test");
  });

  it("derives expiresAt from expires_in", async () => {
    const before = Date.now();
    await post([{ access_token: "at-8", expires_in: 3600, email: "eight@example.test" }]);
    const [conn] = await listGrok();
    const ms = new Date(conn.expiresAt).getTime();
    expect(ms).toBeGreaterThanOrEqual(before + 3599_000);
    expect(ms).toBeLessThanOrEqual(Date.now() + 3600_000);
  });

  it("ignores a caller-supplied provider or id", async () => {
    await post([{ id: "forged", provider: "codex", access_token: "at-9", email: "nine@example.test" }]);
    const [conn] = await listGrok();
    expect(conn.id).not.toBe("forged");
    expect(conn.provider).toBe("grok-cli");
  });
});

describe("grok-cli bulk import — rejection", () => {
  it("400s on a body that is not JSON", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid JSON/i);
  });

  it("400s on an empty account list", async () => {
    const res = await post([]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/No accounts/i);
  });

  it("reports the failing item by index and still imports the rest", async () => {
    const res = await post([
      { access_token: "at-10", email: "ten@example.test" },
      { refresh_token: "rt-only" },
      "not-an-object",
    ]);
    const data = await res.json();
    expect(data.success).toBe(1);
    expect(data.failed).toBe(2);
    expect(data.results.find((r) => r.index === 1)).toMatchObject({ ok: false });
    expect(data.results.find((r) => r.index === 1).error).toMatch(/access/i);
    expect(data.results.find((r) => r.index === 2)).toMatchObject({ ok: false });
    expect(await listGrok()).toHaveLength(1);
  });

  it("never echoes a token back to the caller", async () => {
    const res = await post([{ access_token: "super-secret-at", refresh_token: "super-secret-rt", email: "s@example.test" }]);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("super-secret-at");
    expect(body).not.toContain("super-secret-rt");
  });
});
