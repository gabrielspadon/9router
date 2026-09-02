import { describe, expect, it } from "vitest";

import { PROVIDERS } from "../../open-sse/config/providers.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const COMPATIBILITY_CHAT_URL = "https://api.cohere.ai/compatibility/v1/chat/completions";
const COMPATIBILITY_VALIDATE_URL = "https://api.cohere.ai/compatibility/v1/models";

describe("Cohere compatibility transport", () => {
  it("uses the documented OpenAI-compatible chat and validation endpoints", () => {
    const registryEntry = REGISTRY.find((provider) => provider.id === "cohere");

    expect(registryEntry?.transport).toEqual({
      baseUrl: COMPATIBILITY_CHAT_URL,
      validateUrl: COMPATIBILITY_VALIDATE_URL,
    });
    expect(PROVIDERS.cohere).toMatchObject({
      baseUrl: COMPATIBILITY_CHAT_URL,
      validateUrl: COMPATIBILITY_VALIDATE_URL,
      format: "openai",
    });
    expect(new DefaultExecutor("cohere").buildUrl("command-a-03-2025", true, 0, {})).toBe(COMPATIBILITY_CHAT_URL);
  });
});
