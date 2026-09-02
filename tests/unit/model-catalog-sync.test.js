// Daily models.dev catalog sync — the layer that fills capability gaps for
// models the hand-written tables have never heard of.
//
// The load-bearing property is PRECEDENCE: this fork's tables are deliberately
// richer than models.dev (wider windows, extra thinking flags, #3304's
// text-only Token Plan ruling), so a fetched value must never win over one a
// human wrote. Everything else here guards the failure paths, because this is
// a network fetch on a timer and an outage must be invisible.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// DATA_DIR is captured when @/lib/dataDir.js is first imported, so it has to be
// redirected before anything in the chain loads — hence the dynamic imports.
const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tokenproxy-catalog-test-"));
process.env.DATA_DIR = TMP_DATA_DIR;

const { getCapabilitiesForModel, getStaticCapabilitiesForModel, setCatalogSource } =
  await import("open-sse/providers/capabilities.js");
const {
  CATALOG_FILE,
  getCatalogModalities,
  getCatalogLimits,
  invalidateCatalog,
  installCatalogSource,
} = await import("open-sse/providers/catalogOverride.js");
const { looksLikeVisionModel } = await import("open-sse/providers/visionPatterns.js");
const { getSyncState, startModelCatalogSync, syncModelCatalog } =
  await import("@/lib/modelCatalog/sync.js");

afterEach(() => {
  setCatalogSource(null);
  try { fs.rmSync(CATALOG_FILE, { force: true }); } catch {}
  invalidateCatalog();
});

describe("catalog layers strictly below the hand-written tables", () => {
  // The whole feature is only safe because of this. A remote catalog that
  // disagrees with a human-authored entry loses, at every table layer.
  it("keeps a PROVIDER_CAPABILITIES entry when the catalog contradicts it", () => {
    // #3304: Token Plan chat models are text-only and carry a 1M window.
    const before = getCapabilitiesForModel("xiaomi-tokenplan", "mimo-v2.5-pro");
    expect(before.vision).toBe(false);
    expect(before.contextWindow).toBe(1048576);

    setCatalogSource({
      getModalities: () => ({ vision: true, videoInput: true, pdf: true }),
      getLimits: () => ({ contextWindow: 32000, maxOutput: 4096 }),
    });

    const after = getCapabilitiesForModel("xiaomi-tokenplan", "mimo-v2.5-pro");
    expect(after.vision).toBe(false);
    expect(after.videoInput).toBe(false);
    expect(after.contextWindow).toBe(1048576);
    expect(after.maxOutput).toBe(before.maxOutput);
  });

  it("keeps a MODEL_CAPABILITIES entry when the catalog contradicts it", () => {
    const before = getCapabilitiesForModel("glm", "glm-4.6v");
    expect(before.contextWindow).toBe(128000);

    setCatalogSource({
      getModalities: () => ({}),
      getLimits: () => ({ contextWindow: 8000, maxOutput: 512 }),
    });

    expect(getCapabilitiesForModel("glm", "glm-4.6v").contextWindow).toBe(128000);
    expect(getCapabilitiesForModel("glm", "glm-4.6v").vision).toBe(true);
  });

  it("does fill a gap the tables leave open", () => {
    const model = "totally-unknown-model-xyz";
    expect(getStaticCapabilitiesForModel("someprovider", model).vision).toBe(false);

    setCatalogSource({
      getModalities: (m) => (m === model ? { vision: true, pdf: true } : null),
      getLimits: (p) => (p === "someprovider" ? { contextWindow: 456789, maxOutput: 4321 } : null),
    });

    const caps = getStaticCapabilitiesForModel("someprovider", model);
    expect(caps.vision).toBe(true);
    expect(caps.pdf).toBe(true);
    expect(caps.contextWindow).toBe(456789);
    expect(caps.maxOutput).toBe(4321);
  });

  it("only ever turns a capability on, never off", () => {
    const model = "totally-unknown-model-xyz";
    setCatalogSource({
      getModalities: () => ({ vision: false, pdf: false }),
      getLimits: () => null,
    });
    expect(getStaticCapabilitiesForModel("someprovider", model).vision).toBe(false);
  });

  it("still lets the user's own overrides win over the catalog", () => {
    const model = "totally-unknown-model-xyz";
    process.env.MODEL_CAPABILITY_OVERRIDES = JSON.stringify({ [model]: { vision: false } });
    setCatalogSource({ getModalities: () => ({ vision: true }), getLimits: () => null });
    try {
      expect(getCapabilitiesForModel("someprovider", model).vision).toBe(false);
    } finally {
      delete process.env.MODEL_CAPABILITY_OVERRIDES;
    }
  });
});

describe("name-based vision fallback", () => {
  it("recognises modality words in a model id", () => {
    for (const id of ["qwen3-vl-plus", "glm-4.6v", "llava-1.6", "pixtral-large", "gpt-4o-omni"]) {
      expect(looksLikeVisionModel(id)).toBe(true);
    }
  });

  it("never claims vision for image generation, embeddings or speech", () => {
    for (const id of ["gpt-image-1", "flux-pro", "text-embedding-3-small", "whisper-large-v3", "gpt-4v"]) {
      expect(looksLikeVisionModel(id)).toBe(false);
    }
  });

  it("cannot demote a model the tables already declared", () => {
    // Token Plan TTS ids are declared vision:false by hand; the heuristic is
    // reached only from the pattern/floor layers, so it never sees them.
    expect(getCapabilitiesForModel("xiaomi-tokenplan", "mimo-v2.5-tts").vision).toBe(false);
  });
});

describe("failure paths are closed and silent", () => {
  it("returns null instead of throwing when the catalog file is absent", () => {
    invalidateCatalog();
    expect(getCatalogModalities("anything")).toBeNull();
    expect(getCatalogLimits("someprovider", "anything")).toBeNull();
  });

  it("survives a corrupt catalog file", () => {
    fs.mkdirSync(path.dirname(CATALOG_FILE), { recursive: true });
    fs.writeFileSync(CATALOG_FILE, "{ not json", "utf8");
    invalidateCatalog();
    expect(getCatalogModalities("anything")).toBeNull();
    expect(getCapabilitiesForModel("someprovider", "some-model").contextWindow).toBeGreaterThan(0);
  });

  it("swallows a models.dev outage and leaves capability lookup working", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("ENOTFOUND models.dev"); };
    try {
      await expect(syncModelCatalog()).resolves.toBeNull();
      expect(getSyncState().lastError).toMatch(/ENOTFOUND/);
      expect(getCapabilitiesForModel("glm", "glm-4.6v").contextWindow).toBe(128000);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("swallows a non-200 response", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("nope", { status: 503 });
    try {
      await expect(syncModelCatalog()).resolves.toBeNull();
      expect(getSyncState().lastError).toMatch(/503/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("restores the catalog reader after a mid-sync failure", async () => {
    await installCatalogSource();
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("{ truncated", { status: 200 });
    try {
      await expect(syncModelCatalog()).resolves.toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
    // A failed sync must not leave capabilities.js without its reader.
    fs.mkdirSync(path.dirname(CATALOG_FILE), { recursive: true });
    fs.writeFileSync(CATALOG_FILE, JSON.stringify({
      v: 1, models: { "probe-model-abc": { vision: true } }, providers: {},
    }), "utf8");
    invalidateCatalog();
    expect(getStaticCapabilitiesForModel("someprovider", "probe-model-abc").vision).toBe(true);
  });
});

describe("the scheduler", () => {
  it("does not arm a timer when MODEL_CATALOG_SYNC=off", () => {
    process.env.MODEL_CATALOG_SYNC = "off";
    try {
      startModelCatalogSync();
      expect(getSyncState().scheduled).toBe(false);
    } finally {
      delete process.env.MODEL_CATALOG_SYNC;
    }
  });

  it("does not arm a timer during a Next build phase", () => {
    const prev = process.env.NEXT_PHASE;
    process.env.NEXT_PHASE = "phase-production-build";
    try {
      startModelCatalogSync();
      expect(getSyncState().scheduled).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.NEXT_PHASE;
      else process.env.NEXT_PHASE = prev;
    }
  });
});

describe("a sync does not erase its own output", () => {
  // The delta is measured against the hand-written tables ALONE. Measuring it
  // against the previously written catalog made every still-agreeing value look
  // like "no change", so the second run dropped it.
  it("writes the same delta on a second run", async () => {
    const { default: registry } = await import("open-sse/providers/registry/index.js");

    // A registry model whose own contextLength does not already pin the window.
    let target = null;
    for (const provider of registry) {
      const model = (provider.models || []).find((m) => !m.contextLength);
      if (model) { target = { provider: provider.id, model: model.id }; break; }
    }
    expect(target).not.toBeNull();

    const current = getStaticCapabilitiesForModel(target.provider, target.model);
    const upstreamContext = current.contextWindow * 3;
    const catalog = {
      [target.provider]: {
        models: {
          [target.model]: {
            modalities: { input: ["text"] },
            limit: { context: upstreamContext, output: current.maxOutput },
          },
        },
      },
    };

    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(catalog), {
      status: 200, headers: { "content-type": "application/json" },
    });
    try {
      const first = await syncModelCatalog();
      expect(first.status).toBe("updated");
      const afterFirst = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
      expect(afterFirst.providers[target.provider][target.model].contextWindow).toBe(upstreamContext);

      const second = await syncModelCatalog();
      expect(second.status).toBe("updated");
      const afterSecond = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
      expect(afterSecond.providers[target.provider][target.model].contextWindow).toBe(upstreamContext);
      expect(Object.keys(afterSecond.providers).length).toBe(Object.keys(afterFirst.providers).length);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("counts one modality vote per provider, not one per id variant", async () => {
    // Several ids normalize to the same model (…-thinking:1024, :8192, :32768).
    // If each voted, one gateway could carry a majority on its own.
    const catalog = {
      "gateway-a": {
        models: {
          "vote-probe:1024": { modalities: { input: ["text", "image"] }, limit: {} },
          "vote-probe:8192": { modalities: { input: ["text", "image"] }, limit: {} },
          "vote-probe:32768": { modalities: { input: ["text", "image"] }, limit: {} },
        },
      },
      "gateway-b": { models: { "vote-probe": { modalities: { input: ["text"] }, limit: {} } } },
      "gateway-c": { models: { "vote-probe": { modalities: { input: ["text"] }, limit: {} } } },
    };

    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(catalog), { status: 200 });
    try {
      await syncModelCatalog();
    } finally {
      globalThis.fetch = realFetch;
    }

    // 1 of 3 gateways declares image → below the majority, so no vision.
    const written = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
    expect(written.models["vote-probe"]).toBeUndefined();
  });
});
