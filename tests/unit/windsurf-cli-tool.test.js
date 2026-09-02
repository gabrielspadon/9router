import { describe, expect, it } from "vitest";

const { CLI_TOOLS } = await import("../../src/shared/constants/cliTools.js");

describe("Windsurf CLI guide", () => {
  it("offers the default-card setup flow for a custom OpenAI provider", () => {
    const tool = CLI_TOOLS.windsurf;

    expect(tool).toMatchObject({
      id: "windsurf",
      name: "Windsurf",
      icon: "wind_power",
      color: "#00BCD4",
      configType: "guide",
    });
    expect(tool.guideSteps).toEqual([
      expect.objectContaining({ step: 1, title: "Open Settings" }),
      expect.objectContaining({ step: 2, title: "Add Custom Provider" }),
      expect.objectContaining({ step: 3, title: "Base URL", value: "{{baseUrl}}", copyable: true }),
      expect.objectContaining({ step: 4, title: "API Key", type: "apiKeySelector" }),
      expect.objectContaining({ step: 5, title: "Select Model", type: "modelSelector" }),
      expect.objectContaining({ step: 6, title: "Save & Select" }),
    ]);
  });
});
