import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";

const MODELS_URL = "https://opengateway.gitlawb.com/v1/models";

describe("Gitlawb OpenGateway provider", () => {
  const gateway = REGISTRY.find((entry) => entry.id === "gitlawb-opengateway");

  it("registers the documented API-key OpenAI endpoint", () => {
    expect(gateway).toMatchObject({
      id: "gitlawb-opengateway",
      alias: "ogw",
      category: "apikey",
      authType: "apikey",
      transport: {
        baseUrl: "https://opengateway.gitlawb.com/v1/chat/completions",
        validateUrl: "https://opengateway.gitlawb.com/v1/credits",
      },
      modelsFetcher: { url: MODELS_URL, type: "openai-list" },
      passthroughModels: true,
    });
    expect(PROVIDERS["gitlawb-opengateway"]).toMatchObject({
      baseUrl: "https://opengateway.gitlawb.com/v1/chat/completions",
      format: "openai",
    });
    expect(gateway.noAuth).not.toBe(true);
    expect(resolveProviderAlias("ogw")).toBe("gitlawb-opengateway");
  });

  it("keeps a small documented seed while allowing the live catalog", () => {
    expect(PROVIDER_MODELS.ogw.map((model) => model.id)).toEqual([
      "auto",
      "xiaomi/mimo-v2.5-pro",
      "xiaomi/mimo-v2.5",
    ]);
  });

  it("normalizes the public OpenAI-shaped model catalogue", () => {
    expect(FILTERS["openai-list"]([
      { id: "xiaomi/mimo-v2.5-pro", name: "MiMo V2.5-Pro" },
      { id: "auto" },
      { name: "missing-id" },
    ])).toEqual([
      { id: "xiaomi/mimo-v2.5-pro", name: "MiMo V2.5-Pro" },
      { id: "auto", name: "auto" },
    ]);
  });
});
