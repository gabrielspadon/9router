import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveBareModelStaticOwner,
  canonicalEchoModel,
  getModelInfoCore,
  parseModel,
  ModelNotFoundError,
} from "open-sse/services/model.js";
import { getProviderModels } from "open-sse/config/providerModels.js";

const originalDataDir = process.env.DATA_DIR;

async function setupDb() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenproxy-bare-model-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();

  const { initDb } = await import("@/lib/db/index.js");
  await initDb();
  const { getModelInfo } = await import("@/sse/services/model.js");

  return {
    getModelInfo,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

describe("bare model resolution", () => {
  let cleanup = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network disabled in tests");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.clearAllMocks();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("resolves prefix-collision models to the prefix-matching provider", () => {
    // glm-5.2 is declared by glm, opencode-go, qianfan, etc. — the name prefix
    // is the deterministic tiebreak, so bare "glm-5.2" means glm/glm-5.2.
    expect(resolveBareModelStaticOwner("glm-5.2")).toBe("glm");
  });

  it("resolves single-owner models without admin data", () => {
    expect(resolveBareModelStaticOwner("claude-opus-4-20250514")).toBe(
      "anthropic",
    );
  });

  it("routes a bare declared xAI model through its catalog owner", async () => {
    await expect(getModelInfoCore("grok-4.6", {})).resolves.toEqual({
      provider: "xai",
      model: "grok-4.6",
    });
  });

  it("routes duplicate bare Grok IDs to xAI", async () => {
    await expect(getModelInfoCore("grok-4.5", {})).resolves.toEqual({
      provider: "xai",
      model: "grok-4.5",
    });
    await expect(getModelInfoCore("grok-4.3", {})).resolves.toEqual({
      provider: "xai",
      model: "grok-4.3",
    });
  });

  it("still resolves a known catalog id (guards the fix below against regressing this)", async () => {
    await expect(getModelInfoCore("grok-4.6", {})).resolves.toEqual({
      provider: "xai",
      model: "grok-4.6",
    });
  });

  it("rejects an unknown bare model instead of guessing a provider from its prefix", async () => {
    // The removed fallback matched bare names against a 5-entry regex prefix
    // table (/^gpt-/ -> "openai" among them) and silently forwarded the
    // request to the guessed provider. "gpt-9999-does-not-exist" matches that
    // rule but is not a real model anywhere in the catalog, so it must now be
    // rejected by name rather than routed to openai.
    await expect(getModelInfoCore("gpt-9999-does-not-exist", {})).rejects.toBeInstanceOf(
      ModelNotFoundError,
    );
    await expect(getModelInfoCore("gpt-9999-does-not-exist", {})).rejects.toMatchObject({
      name: "ModelNotFoundError",
      status: 404,
      model: "gpt-9999-does-not-exist",
      message: expect.stringContaining("gpt-9999-does-not-exist"),
    });
  });

  it("rejects an unknown bare model that matches none of the prefix rules (closes the openai default too)", async () => {
    // The removed fallback defaulted to "openai" even when no regex matched
    // at all — the widest form of the guess. A name with no recognizable
    // provider prefix must be rejected the same way as one that resembles a
    // real prefix.
    await expect(
      getModelInfoCore("totally-nonexistent-zzz-model", {}),
    ).rejects.toMatchObject({
      name: "ModelNotFoundError",
      status: 404,
      model: "totally-nonexistent-zzz-model",
    });
  });

  it("declares the active xAI API model IDs in the catalog", () => {
    expect(getProviderModels("xai").map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "grok-4.6",
        "grok-4.5",
        "grok-build-0.1",
        "grok-4.3",
        "grok-4.20-0309-reasoning",
        "grok-4.20-0309-non-reasoning",
        "grok-4.20-multi-agent-0309",
        "grok-imagine-image",
        "grok-imagine-image-quality",
        "grok-imagine-image-2.0",
        "grok-imagine-video-1.5",
      ]),
    );
  });

  it("preserves explicitly prefixed Grok subscription routing", async () => {
    await expect(getModelInfoCore("gcli/grok-build", {})).resolves.toEqual({
      provider: "grok-cli",
      model: "grok-build",
    });
    expect(parseModel("grok-web/grok-4")).toMatchObject({
      provider: "grok-web",
      model: "grok-4",
    });
  });

  it("routes bare opencode free models via the synced free catalog", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    // freeModelSync persistence: ids stored per provider id in kv scope "freeModels"
    const { setFreeModels } = await import("@/lib/db/repos/freeModelsRepo.js");
    await setFreeModels("opencode", ["big-pickle", "mimo-v2.5-free"]);

    const pickle = await ctx.getModelInfo("big-pickle");
    expect(pickle.provider).toBe("opencode");
    expect(pickle.model).toBe("big-pickle");

    const mimo = await ctx.getModelInfo("mimo-v2.5-free");
    expect(mimo.provider).toBe("opencode");
    expect(mimo.model).toBe("mimo-v2.5-free");
  });

  it("never blind-routes bare -free names to openrouter", async () => {
    // Upstream's failure mode: the hardcoded /^deepseek-/ prefix inference sent
    // bare free-tier names at openrouter, which 400s. In this fork the id is a
    // static opencode-go model, so the registry scan owns it deterministically.
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    const deep = await ctx.getModelInfo("deepseek-v4-flash-free");
    expect(deep.provider).toBe("opencode-go");
    expect(deep.model).toBe("deepseek-v4-flash-free");
  });

  it("routes bare static-registry names without touching the free catalog", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    const info = await ctx.getModelInfo("glm-5.2");
    expect(info.provider).toBe("glm");
    expect(info.model).toBe("glm-5.2");
  });

  it("lets user-defined model aliases win over static catalog owners", async () => {
    const ctx = await setupDb();
    cleanup = ctx.cleanup;

    // Explicit alias intent (e.g. point bare glm-5.2 at opencode's free tier)
    // must beat the deterministic static scan, which would route to glm.
    const { setModelAlias } = await import("@/lib/localDb");
    await setModelAlias("glm-5.2", "oc/glm-5.2");

    const info = await ctx.getModelInfo("glm-5.2");
    expect(info.provider).toBe("opencode");
    expect(info.model).toBe("glm-5.2");
  });
});

describe("canonicalEchoModel", () => {
  it("re-injects the listing prefix for bare names on connection-less catalog providers", () => {
    expect(
      canonicalEchoModel({
        requestedModel: "big-pickle",
        provider: "opencode",
        model: "big-pickle",
      }),
    ).toBe("oc/big-pickle");
    expect(
      canonicalEchoModel({
        requestedModel: "deepseek-v4-flash-free",
        provider: "opencode",
        model: "deepseek-v4-flash-free",
      }),
    ).toBe("oc/deepseek-v4-flash-free");
    expect(
      canonicalEchoModel({
        requestedModel: "mimo-x",
        provider: "mimo-free",
        model: "mimo-x",
      }),
    ).toBe("mmf/mimo-x");
  });

  it("keeps prefixed requests and non-catalog bare names exactly as sent", () => {
    expect(
      canonicalEchoModel({
        requestedModel: "oc/big-pickle",
        provider: "opencode",
        model: "big-pickle",
      }),
    ).toBe("oc/big-pickle");
    expect(
      canonicalEchoModel({
        requestedModel: "opencode/big-pickle",
        provider: "opencode",
        model: "big-pickle",
      }),
    ).toBe("opencode/big-pickle");
    expect(
      canonicalEchoModel({
        requestedModel: "gpt-4o",
        provider: "openai",
        model: "gpt-4o",
      }),
    ).toBe("gpt-4o");
  });

  it("passes through missing requested models", () => {
    expect(
      canonicalEchoModel({
        requestedModel: "",
        provider: "opencode",
        model: "big-pickle",
      }),
    ).toBe("");
    expect(
      canonicalEchoModel({
        requestedModel: undefined,
        provider: "opencode",
        model: "big-pickle",
      }),
    ).toBeUndefined();
  });
});
