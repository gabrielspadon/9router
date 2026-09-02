import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { APIKEY_PROVIDERS, getProviderByAlias } from "../../src/shared/constants/providers.js";
import { isValidModel } from "../../src/shared/constants/models.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { getProviderIconSrc } from "../../src/shared/utils/providerIcon.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const PROVIDERS_UNDER_TEST = [
  {
    id: "sumopod",
    alias: "sp",
    baseUrl: "https://ai.sumopod.com/v1/chat/completions",
    validateUrl: "https://ai.sumopod.com/v1/models",
    models: ["gpt-4o-mini", "gemini/gemini-3.1-flash-lite", "deepseek-v4-flash"],
  },
  {
    id: "x5lab",
    alias: "x5l",
    baseUrl: "https://api.x5lab.dev/v1/chat/completions",
    validateUrl: "https://api.x5lab.dev/v1/models",
    models: ["claude-opus-4.6", "gpt-5.5", "gpt-5.3-codex", "kimi-k2.5", "glm-5", "qwen3-coder-next"],
  },
];

describe("SumoPod and X5Lab API-key providers", () => {
  it.each(PROVIDERS_UNDER_TEST)("registers $id as a Bearer OpenAI-compatible passthrough", ({ id, alias, baseUrl, validateUrl, models }) => {
    const entry = REGISTRY.find((provider) => provider.id === id);

    expect(entry).toMatchObject({
      id,
      alias,
      category: "apikey",
      authType: "apikey",
      authModes: ["apikey"],
      transport: { baseUrl, validateUrl },
      passthroughModels: true,
    });
    expect(entry.modelsFetcher).toBeUndefined();
    expect(PROVIDERS[id]).toMatchObject({ baseUrl, validateUrl, format: "openai" });
    expect(PROVIDER_MODELS[alias].map((model) => model.id)).toEqual(models);
    expect(APIKEY_PROVIDERS[id]).toMatchObject({ id, alias, passthroughModels: true });
    expect(getProviderByAlias(alias)?.id).toBe(id);
    expect(resolveProviderAlias(alias)).toBe(id);
    expect(isValidModel(id, "newly-released-model")).toBe(true);
  });

  it.each(PROVIDERS_UNDER_TEST)("uses a Bearer API key for $id", ({ id }) => {
    expect(new DefaultExecutor(id).buildHeaders({ apiKey: "provider-test-key", providerSpecificData: {} })).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer provider-test-key",
      Accept: "text/event-stream",
    });
  });

  it.each(PROVIDERS_UNDER_TEST)("ships the official 128px $id provider mark", ({ id }) => {
    const iconPath = join(repoRoot, "public", "providers", `${id}.png`);
    const icon = readFileSync(iconPath);

    expect(getProviderIconSrc(id)).toBe(`/providers/${id}.png`);
    expect(existsSync(iconPath)).toBe(true);
    expect(icon.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect({ width: icon.readUInt32BE(16), height: icon.readUInt32BE(20) }).toEqual({
      width: 128,
      height: 128,
    });
  });
});
