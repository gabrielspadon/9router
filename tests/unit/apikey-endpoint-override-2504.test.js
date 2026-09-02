// A built-in API-key provider had no way to name its own endpoint: Kimi's
// coding plan and Volcengine Ark's token plan share a provider entry with the
// standard plan and differ only by base URL, so each plan needed its own
// registry entry and icon (#2504). The connection now carries the override.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let collection;
let connection;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenproxy-endpoint-override-"));
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

function post(body) {
  return collection.POST(new Request("http://localhost/api/providers", {
    method: "POST",
    body: JSON.stringify(body),
  }));
}

function put(id, body) {
  return connection.PUT(
    new Request(`http://localhost/api/providers/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

async function created(body) {
  const res = await post({ provider: "kimi", apiKey: "sk-test", name: `c-${Math.random()}`, ...body });
  expect(res.status).toBe(201);
  return (await res.json()).connection;
}

describe("per-connection endpoint override for an API-key provider (#2504)", () => {
  it("stores a base URL and an API type the caller names", async () => {
    const conn = await created({ baseUrl: "https://api.moonshot.cn/anthropic/", apiType: "responses" });
    // The trailing slash is normalized away, because every consumer appends its
    // own path segment to this value.
    expect(conn.providerSpecificData).toMatchObject({
      baseUrl: "https://api.moonshot.cn/anthropic",
      apiType: "responses",
    });
    const stored = await db.getProviderConnectionById(conn.id);
    expect(stored.providerSpecificData.baseUrl).toBe("https://api.moonshot.cn/anthropic");
  });

  it("a connection that names no endpoint keeps the registry default", async () => {
    const conn = await created({});
    expect(conn.providerSpecificData?.baseUrl).toBeUndefined();
    expect(conn.providerSpecificData?.apiType).toBeUndefined();
  });

  it("refuses a base URL that is not an absolute http(s) URL", async () => {
    for (const baseUrl of ["api.moonshot.cn", "ftp://api.moonshot.cn", "javascript:alert(1)", "/v1"]) {
      const res = await post({ provider: "kimi", apiKey: "sk", name: "x", baseUrl });
      expect(res.status, baseUrl).toBe(400);
    }
    expect(await db.getProviderConnections()).toEqual([]);
  });

  it("refuses an API type outside the vocabulary the executor understands", async () => {
    // "anthropic" is what the report asks for next; it is not a value anything
    // reads yet, so accepting it would store a setting with no effect.
    const res = await post({ provider: "kimi", apiKey: "sk", name: "x", apiType: "anthropic" });
    expect(res.status).toBe(400);
  });

  it("an edit changes the override, and an empty value clears it", async () => {
    const conn = await created({ baseUrl: "https://one.example.com/v1" });
    const changed = await put(conn.id, { baseUrl: "https://two.example.com/v1" });
    expect(changed.status).toBe(200);
    expect((await changed.json()).connection.providerSpecificData.baseUrl).toBe("https://two.example.com/v1");

    const cleared = await put(conn.id, { baseUrl: "" });
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).connection.providerSpecificData.baseUrl).toBeUndefined();
  });

  it("an edit rejects a new bad URL without touching what is stored", async () => {
    const conn = await created({ baseUrl: "https://one.example.com/v1" });
    const res = await put(conn.id, { baseUrl: "one.example.com" });
    expect(res.status).toBe(400);
    const stored = await db.getProviderConnectionById(conn.id);
    expect(stored.providerSpecificData.baseUrl).toBe("https://one.example.com/v1");
  });

  it("echoing a value written before this check does not block editing the rest", async () => {
    // The dashboard's edit form re-submits every field it rendered, so a
    // connection stored with a bare host must stay editable.
    const conn = await created({});
    await db.updateProviderConnection(conn.id, { providerSpecificData: { baseUrl: "localhost:11434" } });
    const res = await put(conn.id, { name: "renamed", providerSpecificData: { baseUrl: "localhost:11434" } });
    expect(res.status).toBe(200);
    const stored = await db.getProviderConnectionById(conn.id);
    expect(stored.name).toBe("renamed");
    expect(stored.providerSpecificData.baseUrl).toBe("localhost:11434");
  });

  it("the nested shape the existing baseUrlField form sends is accepted too", async () => {
    const conn = await created({ providerSpecificData: { baseUrl: "https://nested.example.com/v1" } });
    expect(conn.providerSpecificData.baseUrl).toBe("https://nested.example.com/v1");
  });

  it("a compatible provider still takes its endpoint from its node, not the caller", async () => {
    // Not a 400: the value is not validated because it is not used — the node
    // below owns the endpoint, so the caller's is discarded either way.
    const res = await post({
      provider: "openai-compatible-chat-missing",
      name: "x",
      baseUrl: "not-a-url",
    });
    expect(res.status).toBe(404);
  });
});
