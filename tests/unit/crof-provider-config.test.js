import { describe, expect, it } from "vitest";

import { PROVIDERS } from "../../open-sse/config/providers.js";
import { APIKEY_PROVIDERS, getProviderByAlias } from "../../src/shared/constants/providers.js";
import { isValidModel } from "../../src/shared/constants/models.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

describe("Crof AI provider configuration", () => {
  it("registers Crof as an API-key OpenAI-compatible passthrough provider", () => {
    const entry = REGISTRY.find((provider) => provider.id === "crof-ai");

    expect(entry).toMatchObject({
      id: "crof-ai",
      alias: "crof",
      category: "apikey",
      authType: "apikey",
      transport: { baseUrl: "https://crof.ai/v1/chat/completions" },
      serviceKinds: ["llm", "imageToText"],
      passthroughModels: true,
      display: {
        name: "Crof AI",
        website: "https://crof.ai",
        notice: { apiKeyUrl: "https://crof.ai/docs" },
      },
    });
    expect(PROVIDERS["crof-ai"]).toMatchObject({
      baseUrl: "https://crof.ai/v1/chat/completions",
      format: "openai",
    });
    expect(APIKEY_PROVIDERS["crof-ai"]).toMatchObject({
      id: "crof-ai",
      alias: "crof",
      passthroughModels: true,
    });
    expect(getProviderByAlias("crof")?.id).toBe("crof-ai");
    expect(resolveProviderAlias("crof")).toBe("crof-ai");
    expect(isValidModel("crof-ai", "greg-2-super")).toBe(true);
  });
});
