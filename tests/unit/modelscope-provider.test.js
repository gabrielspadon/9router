import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { FREE_TIER_PROVIDERS, getProviderByAlias } from "../../src/shared/constants/providers.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("ModelScope API Inference provider", () => {
  it("registers the documented free-tier OpenAI endpoint and current seed models", () => {
    const entry = REGISTRY.find((provider) => provider.id === "modelscope");

    expect(entry).toMatchObject({
      id: "modelscope",
      alias: "ms",
      category: "freeTier",
      authType: "apikey",
      transport: {
        baseUrl: "https://api-inference.modelscope.cn/v1/chat/completions",
      },
    });
    expect(entry.thinkingConfig).toBeUndefined();
    expect(PROVIDERS.modelscope).toMatchObject({
      baseUrl: "https://api-inference.modelscope.cn/v1/chat/completions",
      format: "openai",
    });
    expect(PROVIDER_MODELS.ms.map((model) => model.id)).toEqual([
      "deepseek-ai/DeepSeek-V4-Pro",
      "ZhipuAI/GLM-5.2",
    ]);
    expect(FREE_TIER_PROVIDERS.modelscope).toMatchObject({ id: "modelscope", alias: "ms" });
    expect(FREE_TIER_PROVIDERS.modelscope.thinkingConfig).toBeUndefined();
    expect(getProviderByAlias("ms")?.id).toBe("modelscope");
    expect(resolveProviderAlias("ms")).toBe("modelscope");
  });

  it("sends the ModelScope access token as a Bearer credential", () => {
    const headers = new DefaultExecutor("modelscope").buildHeaders({
      apiKey: "ms-test-token",
      providerSpecificData: {},
    });

      expect(headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer ms-test-token",
        Accept: "text/event-stream",
      });
    });

    it("ships the official ModelScope mark as a 128px provider icon", async () => {
      const { getProviderIconSrc } = await import("../../src/shared/utils/providerIcon.js");
      const iconPath = join(repoRoot, "public", "providers", "modelscope.png");
      const icon = readFileSync(iconPath);

      expect(getProviderIconSrc("modelscope")).toBe("/providers/modelscope.png");
      expect(existsSync(iconPath)).toBe(true);
      expect(icon.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
      expect({ width: icon.readUInt32BE(16), height: icon.readUInt32BE(20) }).toEqual({
        width: 128,
        height: 128,
      });
    });
  });
