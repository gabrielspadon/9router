import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;

async function setupDatabase() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenproxy-combo-models-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();

  const db = await import("@/lib/db/index.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  await db.initDb();
  return { db, adapter: await getAdapter() };
}

function insertCombo(adapter, { id, name, models, createdAt }) {
  adapter.run(
    "INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)",
    [id, name, null, models, createdAt, createdAt]
  );
}

afterEach(() => {
  try {
    global._dbAdapter?.instance?.close?.();
  } catch {}
  delete global._dbAdapter;
  vi.resetModules();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("combo repository model normalization", () => {
  it("returns arrays to repository and API consumers for malformed persisted model values", async () => {
    const { db, adapter } = await setupDatabase();
    insertCombo(adapter, { id: "null", name: "null-models", models: "null", createdAt: "2026-01-01T00:00:00.000Z" });
    insertCombo(adapter, { id: "string", name: "string-models", models: '"openai/gpt-5"', createdAt: "2026-01-01T00:00:01.000Z" });
    insertCombo(adapter, { id: "object", name: "object-models", models: '{"model":"openai/gpt-5"}', createdAt: "2026-01-01T00:00:02.000Z" });
    insertCombo(adapter, { id: "valid", name: "valid-models", models: '["openai/gpt-5","anthropic/claude"]', createdAt: "2026-01-01T00:00:03.000Z" });

    const expectedModels = {
      null: [],
      string: [],
      object: [],
      valid: ["openai/gpt-5", "anthropic/claude"],
    };
    const byId = Object.fromEntries((await db.getCombos()).map((combo) => [combo.id, combo.models]));
    expect(byId).toEqual(expectedModels);

    const { GET } = await import("@/app/api/combos/route.js");
    const response = await GET();
    expect(response.status).toBe(200);
    const { combos } = await response.json();
    expect(Object.fromEntries(combos.map((combo) => [combo.id, combo.models]))).toEqual(expectedModels);
    expect(combos.every((combo) => Array.isArray(combo.models))).toBe(true);
  });
});
