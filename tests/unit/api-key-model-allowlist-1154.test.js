// A key's three spend ceilings bound how much it can burn but say nothing about
// WHICH model burns it (#1154), so the only way to keep an expensive model away
// from a shared key was to not connect that provider at all.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { matchesAllowedModel, pickLimits } from "@/lib/db/repos/apiKeysRepo.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let repo;
let adapter;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenproxy-key-models-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  repo = await import("@/lib/db/repos/apiKeysRepo.js");
  await db.initDb();
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(() => {
  adapter.run("DELETE FROM apiKeys");
  adapter.run("DELETE FROM kv WHERE scope = 'apiKeyModels'");
});

async function newKey(name, data) {
  const created = await db.createApiKey(name, "machine-a");
  const stored = data ? await db.updateApiKey(created.id, data) : created;
  return { ...created, ...stored };
}

describe("nothing about the schema changes (#1154)", () => {
  it("the allowlist lives in kv, the way disabled models and pricing already do", async () => {
    const key = await newKey("scoped", { allowedModels: ["gpt-4o"] });
    const row = adapter.get("SELECT value FROM kv WHERE scope = 'apiKeyModels' AND key = ?", [key.id]);
    expect(JSON.parse(row.value)).toEqual(["gpt-4o"]);
    // No column was added, so no migration and no install-time schema change.
    expect(adapter.all("PRAGMA table_info(apiKeys)").map((c) => c.name)).not.toContain("allowedModels");
  });

  it("unrestricted is the absence of a row, not a sentinel", async () => {
    const key = await newKey("plain");
    expect(adapter.get("SELECT value FROM kv WHERE scope = 'apiKeyModels' AND key = ?", [key.id])).toBeFalsy();
  });

  it("deleting a key takes its allowlist with it, so a reused id cannot inherit one", async () => {
    const key = await newKey("scoped", { allowedModels: ["gpt-4o"] });
    await db.deleteApiKey(key.id);
    expect(adapter.get("SELECT value FROM kv WHERE scope = 'apiKeyModels' AND key = ?", [key.id])).toBeFalsy();
  });

  it("a bulk revoke clears them too", async () => {
    const a = await newKey("a", { allowedModels: ["gpt-4o"] });
    const b = await newKey("b", { allowedModels: ["gpt-4o"] });
    const repoMod = await import("@/lib/db/repos/apiKeysRepo.js");
    expect(await repoMod.deleteApiKeys([a.id, b.id])).toBe(2);
    expect(adapter.all("SELECT key FROM kv WHERE scope = 'apiKeyModels'")).toEqual([]);
  });
});

describe("a key with no allowlist behaves exactly as it always did", () => {
  it("reports null", async () => {
    const key = await newKey("plain");
    expect(key.allowedModels).toBeNull();
    expect((await db.getApiKeyById(key.id)).allowedModels).toBeNull();
    expect((await db.getApiKeys()).every((k) => k.allowedModels === null)).toBe(true);
  });

  it("may route anything", async () => {
    const key = await newKey("plain");
    expect(await repo.isModelAllowed(key.key, "openai/gpt-4o")).toBe(true);
    expect(await repo.isModelAllowed(key.key, "anything-at-all")).toBe(true);
  });

  it("local mode, where there is no key at all, is not restricted", async () => {
    expect(await repo.isModelAllowed(null, "openai/gpt-4o")).toBe(true);
    expect(await repo.isModelAllowed("", "openai/gpt-4o")).toBe(true);
  });
});

describe("a key with an allowlist admits only what is on it", () => {
  it("admits a listed model and refuses an unlisted one", async () => {
    const key = await newKey("scoped", { allowedModels: ["gpt-3.5-turbo", "gemini-1.5-flash"] });
    expect(key.allowedModels).toEqual(["gpt-3.5-turbo", "gemini-1.5-flash"]);
    expect(await repo.isModelAllowed(key.key, "gpt-3.5-turbo")).toBe(true);
    expect(await repo.isModelAllowed(key.key, "gpt-4o")).toBe(false);
  });

  it("a bare entry admits the provider-qualified request for the same model, and back", async () => {
    const key = await newKey("scoped", { allowedModels: ["gpt-3.5-turbo"] });
    expect(await repo.isModelAllowed(key.key, "openai/gpt-3.5-turbo")).toBe(true);
    const qualified = await newKey("q", { allowedModels: ["openai/gpt-4o"] });
    expect(await repo.isModelAllowed(qualified.key, "gpt-4o")).toBe(true);
  });

  it("two qualified names must match exactly, so one provider's entry never admits another's", () => {
    expect(matchesAllowedModel(["openai/gpt-4o"], "azure/gpt-4o")).toBe(false);
    expect(matchesAllowedModel(["openai/gpt-4o"], "openai/gpt-4o")).toBe(true);
  });

  it("matching ignores case and surrounding space, which is how a pasted list arrives", () => {
    expect(matchesAllowedModel([" GPT-4o "], "openai/gpt-4o")).toBe(true);
  });

  it("an empty request model is refused rather than admitted by default", () => {
    expect(matchesAllowedModel(["gpt-4o"], "")).toBe(false);
    expect(matchesAllowedModel(["gpt-4o"], null)).toBe(false);
  });

  it("a key the table does not hold is unrestricted, since the key check itself already refused it", async () => {
    expect(await repo.isModelAllowed("sk-not-a-key", "gpt-4o")).toBe(true);
  });
});

describe("the stored value is normalized on the way in", () => {
  it("blanks and duplicates are dropped", async () => {
    const key = await newKey("messy", { allowedModels: ["gpt-4o", " gpt-4o ", "", "  ", 7, null] });
    expect(key.allowedModels).toEqual(["gpt-4o"]);
  });

  it("an empty list means every model, not no model, so a key is never bricked by one", async () => {
    const key = await newKey("empty", { allowedModels: [] });
    expect(key.allowedModels).toBeNull();
    expect(await repo.isModelAllowed(key.key, "anything")).toBe(true);
  });

  it("null clears an allowlist back to every model", async () => {
    const key = await newKey("scoped", { allowedModels: ["gpt-4o"] });
    expect(await repo.isModelAllowed(key.key, "claude-4")).toBe(false);
    await db.updateApiKey(key.id, { allowedModels: null });
    expect(await repo.isModelAllowed(key.key, "claude-4")).toBe(true);
  });

  it("a value that is not a list at all is read as no restriction rather than locking the operator out", async () => {
    const key = await newKey("corrupt");
    adapter.run("INSERT INTO kv(scope, key, value) VALUES('apiKeyModels', ?, ?)", [key.id, "{not json"]);
    expect(await repo.isModelAllowed(key.key, "gpt-4o")).toBe(true);
    expect((await db.getApiKeyById(key.id)).allowedModels).toBeNull();
  });

  it("setting the allowlist leaves the spend ceilings alone, and the other way round", async () => {
    const key = await newKey("both", { maxPromptTokens: 100, allowedModels: ["gpt-4o"] });
    expect(key.maxPromptTokens).toBe(100);
    const after = await db.updateApiKey(key.id, { maxCostUsd: 5 });
    expect(after.allowedModels).toEqual(["gpt-4o"]);
    expect(after.maxPromptTokens).toBe(100);
  });
});

describe("the keys API carries it the same way it carries a ceiling", () => {
  it("pickLimits takes allowedModels alongside the three ceilings", () => {
    expect(pickLimits({ allowedModels: ["a"], maxCostUsd: 1, name: "ignored" }))
      .toEqual({ allowedModels: ["a"], maxCostUsd: 1 });
  });

  it("an omitted field is left as it was; an explicit null is a clear", () => {
    expect(pickLimits({})).toEqual({});
    expect(pickLimits({ allowedModels: null })).toEqual({ allowedModels: null });
  });
});
