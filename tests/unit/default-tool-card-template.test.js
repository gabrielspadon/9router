import { describe, expect, it } from "vitest";
import { replaceGuideVariables } from "@/app/(dashboard)/dashboard/cli-tools/components/DefaultToolCard.js";

const template = "base={{baseUrl}} key={{apiKey}} model={{model}}";

describe("DefaultToolCard guide template replacement", () => {
  it.each([
    ["bare URL", "http://localhost:20128", "http://localhost:20128/v1"],
    ["exact /v1 URL", "https://router.example/v1", "https://router.example/v1"],
    ["trailing-slash /v1 URL", "https://router.example/v1/", "https://router.example/v1"],
  ])("normalizes %s to one /v1", (_name, baseUrl, expectedBaseUrl) => {
    const output = replaceGuideVariables(template, {
      baseUrl,
      apiKey: "sk-test",
      cloudEnabled: false,
      model: "provider/model",
    });

    expect(output).toBe(`base=${expectedBaseUrl} key=sk-test model=provider/model`);
    expect(output).not.toContain("/v1/v1");
    expect(output).not.toContain("/v1//v1");
  });

  it("preserves current API-key and model fallbacks", () => {
    expect(replaceGuideVariables("{{apiKey}}|{{model}}", {
      baseUrl: "http://localhost:20128",
      apiKey: "",
      cloudEnabled: false,
      model: "",
    })).toBe("sk_tokenproxy|provider/model-id");

    expect(replaceGuideVariables("{{apiKey}}", {
      baseUrl: "http://localhost:20128",
      apiKey: " ",
      cloudEnabled: true,
      model: "",
    })).toBe("your-api-key");
  });
});
