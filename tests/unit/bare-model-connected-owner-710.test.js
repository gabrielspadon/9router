import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// A bare model id declared by several providers used to resolve to the FIRST
// one in registry import order — alphabetical, and unrelated to what the user
// connected (#710). "gpt-5.4" is declared by blackbox, cx, gh, openai, bzl and
// opencode-zen, so a user with only an OpenAI key was routed to blackbox and
// told, truthfully, that there were no credentials for a provider they had
// never chosen.
const COLLIDING_MODEL = "gpt-5.4";

// Derived, not hardcoded. The registry index is generated deterministically
// (#2955), so regenerating it legitimately changes which declarer comes first;
// pinning a provider name here made that regeneration look like a routing
// regression. The INVARIANT is that an unconnected lookup keeps whichever owner
// import order yields, so ask the registry which that is.
async function importOrderOwner() {
  // Resolved exactly as staticOwnersOf does: iterate PROVIDER_MODELS in
  // declaration order and map the alias through resolveProviderAlias, because
  // the alias and the provider id are not the same string.
  // Same modules staticOwnersOf uses: PROVIDER_MODELS is keyed by ALIAS and the
  // owner is that alias resolved to a provider id, which is a different string.
  const { PROVIDER_MODELS } = await import("open-sse/config/providerModels.js");
  const { resolveProviderAlias } = await import("open-sse/services/model.js");
  for (const [alias, models] of Object.entries(PROVIDER_MODELS)) {
    if ((models || []).some((m) => m?.id === COLLIDING_MODEL)) {
      return resolveProviderAlias(alias);
    }
  }
  throw new Error(`no provider declares ${COLLIDING_MODEL}; the fixture model is stale`);
}

const originalDataDir = process.env.DATA_DIR;
let cleanup = () => {};

async function bootDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenproxy-710-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  cleanup = () => fs.rmSync(tempDir, { recursive: true, force: true });
  return db;
}

async function connect(db, provider) {
  await db.createProviderConnection({
    provider,
    name: `${provider} test`,
    authType: "apikey",
    apiKey: "sk-test",
    isActive: true,
  });
}

describe("bare model with several static owners prefers a connected one (#710)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network disabled in tests"); }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("keeps the import-order owner when nothing is connected", async () => {
    await bootDb();
    const { getModelInfo } = await import("@/sse/services/model.js");
    await expect(getModelInfo(COLLIDING_MODEL)).resolves.toEqual({
      provider: (await importOrderOwner()),
      model: COLLIDING_MODEL,
    });
  });

  it("routes to the owner the user actually connected", async () => {
    const db = await bootDb();
    await connect(db, "openai");
    const { getModelInfo } = await import("@/sse/services/model.js");
    await expect(getModelInfo(COLLIDING_MODEL)).resolves.toEqual({
      provider: "openai",
      model: COLLIDING_MODEL,
    });
  });

  it("keeps the import-order owner when IT is the connected one", async () => {
    const db = await bootDb();
    await connect(db, (await importOrderOwner()));
    await connect(db, "openai");
    const { getModelInfo } = await import("@/sse/services/model.js");
    await expect(getModelInfo(COLLIDING_MODEL)).resolves.toEqual({
      provider: (await importOrderOwner()),
      model: COLLIDING_MODEL,
    });
  });

  it("ignores a connection to a provider that does not declare the model", async () => {
    const db = await bootDb();
    await connect(db, "mistral");
    const { getModelInfo } = await import("@/sse/services/model.js");
    await expect(getModelInfo(COLLIDING_MODEL)).resolves.toEqual({
      provider: (await importOrderOwner()),
      model: COLLIDING_MODEL,
    });
  });

  it("leaves a single-owner bare model alone", async () => {
    const db = await bootDb();
    await connect(db, "openai");
    const { getModelInfo } = await import("@/sse/services/model.js");
    await expect(getModelInfo("claude-opus-4-20250514")).resolves.toEqual({
      provider: "anthropic",
      model: "claude-opus-4-20250514",
    });
  });
});
