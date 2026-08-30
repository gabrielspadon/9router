import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let cleanup = async () => {};

async function setup(forceAdapter) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-provider-cleanup-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  cleanup = async () => {
    try {
      global._dbAdapter?.instance?.close?.();
    } catch {
      // Best effort cleanup for adapters whose close already ran.
    }
    delete global._dbAdapter;
    fs.rmSync(tempDir, { recursive: true, force: true });
  };
  vi.resetModules();
  if (forceAdapter === "node:sqlite" || forceAdapter === "sql.js") {
    vi.doMock("@/lib/db/adapters/betterSqliteAdapter.js", () => ({
      createBetterSqliteAdapter: () => null,
    }));
  }
  if (forceAdapter === "sql.js") {
    vi.doMock("@/lib/db/adapters/nodeSqliteAdapter.js", () => ({
      createNodeSqliteAdapter: async () => null,
    }));
  }
  vi.doMock("next/server", () => ({
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status || 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  }));

  const customModelsRoute = await import("@/app/api/models/custom/route.js");
  const providerNodeRoute = await import("@/app/api/provider-nodes/[id]/route.js");
  const models = await import("@/models/index.js");
  const { getAdapter } = await import("@/lib/db/driver.js");

  return { customModelsRoute, providerNodeRoute, models, getAdapter };
}

function customModelRequest(body) {
  return new Request("https://9router.local/api/models/custom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  await cleanup();
  cleanup = async () => {};
  vi.doUnmock("next/server");
  vi.doUnmock("@/lib/db/adapters/betterSqliteAdapter.js");
  vi.doUnmock("@/lib/db/adapters/nodeSqliteAdapter.js");
  vi.resetModules();
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("provider deletion alias cleanup", () => {
  it("removes only aliases whose decoded model belongs to the deleted provider", async () => {
    const ctx = await setup();
    const providerId = "openai-compatible-target";
    const targetModel = `${providerId}/model-a`;
    const lookalikeModel = `${providerId}-lookalike/model-b`;
    const otherModel = "openai-compatible-other/model-c";

    await ctx.models.createProviderNode({
      id: providerId,
      type: "openai-compatible",
      name: "Target",
      prefix: "target",
      apiType: "chat",
      baseUrl: "https://target.test/v1",
    });
    await ctx.models.setModelAlias("remove-me", targetModel);
    await ctx.models.setModelAlias("keep-lookalike", lookalikeModel);
    await ctx.models.setModelAlias("keep-other", otherModel);

    const response = await ctx.providerNodeRoute.DELETE(
      new Request(`https://9router.local/api/provider-nodes/${providerId}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: providerId }) }
    );

    expect(response.status).toBe(200);
    expect(await ctx.models.getModelAliases()).toEqual({
      "keep-lookalike": lookalikeModel,
      "keep-other": otherModel,
    });
    expect(await ctx.models.getProviderNodeById(providerId)).toBeNull();
    expect((await ctx.getAdapter()).driver).toMatch(/^(bun:sqlite|better-sqlite3|node:sqlite|sql\.js)$/);
  });

  it.runIf(!process.versions.bun).each(["node:sqlite", "sql.js"])(
    "uses the real %s fallback adapter for exact alias cleanup",
    async (driver) => {
      const ctx = await setup(driver);
      const providerId = `openai-compatible-${driver}`;
      const targetModel = `${providerId}/model-a`;
      const otherModel = `${providerId}-other/model-b`;

      await ctx.models.createProviderNode({
        id: providerId,
        type: "openai-compatible",
        name: driver,
        prefix: driver,
        apiType: "chat",
        baseUrl: "https://target.test/v1",
      });
      await ctx.models.setModelAlias("remove-me", targetModel);
      await ctx.models.setModelAlias("keep-other", otherModel);

      const response = await ctx.providerNodeRoute.DELETE(
        new Request("https://9router.local/api/provider-nodes/target", { method: "DELETE" }),
        { params: Promise.resolve({ id: providerId }) }
      );

      expect(response.status).toBe(200);
      expect((await ctx.getAdapter()).driver).toBe(driver);
      expect(await ctx.models.getModelAliases()).toEqual({ "keep-other": otherModel });
    }
  );
});

describe("custom model token limits API", () => {
  it("persists supplied positive integer input and output limits", async () => {
    const ctx = await setup();
    const response = await ctx.customModelsRoute.POST(customModelRequest({
      providerAlias: "kr",
      id: "claude-opus-4.7",
      type: "llm",
      name: "Claude Opus 4.7",
      maxInputTokens: 1_000_000,
      maxOutputTokens: 64_000,
    }));

    expect(response.status).toBe(200);
    expect(await ctx.models.getCustomModels()).toEqual([{
      providerAlias: "kr",
      id: "claude-opus-4.7",
      type: "llm",
      name: "Claude Opus 4.7",
      maxInputTokens: 1_000_000,
      maxOutputTokens: 64_000,
    }]);
  });

  it("keeps omitted token limits absent from persisted models", async () => {
    const ctx = await setup();
    const response = await ctx.customModelsRoute.POST(customModelRequest({
      providerAlias: "kr",
      id: "claude-sonnet-4.7",
      type: "llm",
      name: "Claude Sonnet 4.7",
    }));

    expect(response.status).toBe(200);
    const [stored] = await ctx.models.getCustomModels();
    expect(Object.hasOwn(stored, "maxInputTokens")).toBe(false);
    expect(Object.hasOwn(stored, "maxOutputTokens")).toBe(false);
  });

  it("rejects supplied limits that are not positive integers without persisting a model", async () => {
    const ctx = await setup();
    const invalidValues = [
      0,
      -1,
      1.5,
      "1",
      "NaN",
      "",
      false,
      true,
      null,
      {},
      [],
    ];

    for (const field of ["maxInputTokens", "maxOutputTokens"]) {
      for (const [index, value] of invalidValues.entries()) {
        const response = await ctx.customModelsRoute.POST(customModelRequest({
          providerAlias: "kr",
          id: `${field}-${index}`,
          [field]: value,
        }));
        expect(response.status, `${field} accepted ${JSON.stringify(value)}`).toBe(400);
        expect(await response.json()).toEqual({ error: `${field} must be a positive integer` });
      }
    }

    expect(await ctx.models.getCustomModels()).toEqual([]);
  });
});
