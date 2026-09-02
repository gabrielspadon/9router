// #999 asks for secure secret storage. Provider credentials are already
// encrypted at rest (src/lib/db/helpers/secretCol.js, AES-256-GCM), so what was
// left open is the other half: keeping the secret from walking back out over
// the dashboard API. Redaction was four `delete` statements copied into each
// route, which missed providerSpecificData entirely — where Copilot's token,
// Azure's clientSecret, Bedrock's key pair, opencode's managementKey and the
// operator's customHeaders actually live. /api/providers honours
// requireLogin=false, so those responses are readable without a session on an
// instance with login turned off.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let collection;
let connection;

const SECRETS = {
  apiKey: "sk-top-level-secret",
  accessToken: "at-top-level-secret",
  refreshToken: "rt-top-level-secret",
  idToken: "it-top-level-secret",
};

const SPECIFIC_SECRETS = {
  apiKey: "psd-apikey-secret",
  accessKeyId: "AKIAPSDSECRET",
  secretAccessKey: "psd-aws-secret",
  clientSecret: "psd-client-secret",
  copilotToken: "psd-copilot-secret",
  managementKey: "psd-management-secret",
  customHeaders: { Authorization: "Bearer psd-header-secret" },
};

// Fields the dashboard actually renders, which must survive redaction.
const SPECIFIC_BENIGN = {
  baseUrl: "https://api.moonshot.cn/anthropic",
  region: "us-east-1",
  authMethod: "social",
};

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenproxy-secret-storage-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  collection = await import("@/app/api/providers/route.js");
  connection = await import("@/app/api/providers/[id]/route.js");
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(async () => {
  for (const c of await db.getProviderConnections()) await db.deleteProviderConnection(c.id);
});

// Every secret is a distinct literal, so "is it anywhere in this response" is a
// stronger check than naming the key that is supposed to be gone: it also
// catches a copy under a different name.
function assertNoSecrets(payload) {
  const body = JSON.stringify(payload);
  for (const [field, value] of Object.entries(SECRETS)) {
    expect(body, `top-level ${field}`).not.toContain(value);
  }
  for (const field of Object.keys(SPECIFIC_SECRETS)) {
    const value = field === "customHeaders" ? "psd-header-secret" : SPECIFIC_SECRETS[field];
    expect(body, `providerSpecificData.${field}`).not.toContain(value);
  }
}

async function seedLoadedConnection() {
  const created = await db.createProviderConnection({
    provider: "kimi",
    authType: "apikey",
    name: "loaded",
    apiKey: SECRETS.apiKey,
    isActive: true,
  });
  // The shape an OAuth flow and a token refresh leave behind.
  await db.updateProviderConnection(created.id, {
    ...SECRETS,
    providerSpecificData: { ...SPECIFIC_SECRETS, ...SPECIFIC_BENIGN },
  });
  return created.id;
}

describe("connection secrets do not leave over the dashboard API (#999)", () => {
  it("the connection list redacts every credential, top level and provider-specific", async () => {
    await seedLoadedConnection();
    const res = await collection.GET();
    expect(res.status).toBe(200);
    const payload = await res.json();

    expect(payload.connections).toHaveLength(1);
    assertNoSecrets(payload);
  });

  it("a single connection redacts the same set", async () => {
    const id = await seedLoadedConnection();
    const res = await connection.GET(
      new Request(`http://localhost/api/providers/${id}`),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    assertNoSecrets(await res.json());
  });

  it("an edit does not echo the credentials back in its response", async () => {
    const id = await seedLoadedConnection();
    const res = await connection.PUT(
      new Request(`http://localhost/api/providers/${id}`, {
        method: "PUT",
        body: JSON.stringify({ name: "renamed" }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.connection.name).toBe("renamed");
    assertNoSecrets(payload);
  });

  it("creating a connection does not echo the key that created it", async () => {
    const res = await collection.POST(new Request("http://localhost/api/providers", {
      method: "POST",
      body: JSON.stringify({ provider: "kimi", apiKey: SECRETS.apiKey, name: "fresh" }),
    }));
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.connection.id).toBeTruthy();
    expect(JSON.stringify(payload)).not.toContain(SECRETS.apiKey);
  });

  it("the fields the dashboard renders survive redaction", async () => {
    const id = await seedLoadedConnection();
    const res = await connection.GET(
      new Request(`http://localhost/api/providers/${id}`),
      { params: Promise.resolve({ id }) },
    );
    const { connection: safe } = await res.json();

    expect(safe.providerSpecificData).toEqual(SPECIFIC_BENIGN);
    expect(safe.id).toBe(id);
    expect(safe.provider).toBe("kimi");
  });

  it("redaction is at the boundary — the router still has the credentials it needs", async () => {
    const id = await seedLoadedConnection();
    await collection.GET();

    const stored = await db.getProviderConnectionById(id);
    expect(stored.accessToken).toBe(SECRETS.accessToken);
    expect(stored.refreshToken).toBe(SECRETS.refreshToken);
    expect(stored.providerSpecificData.copilotToken).toBe(SPECIFIC_SECRETS.copilotToken);
    expect(stored.providerSpecificData.customHeaders).toEqual(SPECIFIC_SECRETS.customHeaders);
  });
});
