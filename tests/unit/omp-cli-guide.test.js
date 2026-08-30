import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const { CLI_TOOLS } = await import("../../src/shared/constants/cliTools.js");
const tool = CLI_TOOLS.omp;
const expectedYaml = `providers:
  9router:
    baseUrl: {{baseUrl}}
    api: openai-completions
    apiKey: {{apiKey}}
    authHeader: true
    discovery:
      type: openai-models-list`;

function source(relativePath) {
  return fs.readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("Oh My Pi CLI guide", () => {
  it("registers a default-card guide without an image asset", () => {
    expect(tool.id).toBe("omp");
    expect(tool.name).toBe("Oh My Pi");
    expect(tool.configType).toBe("guide");
    expect(tool.icon).toBe("terminal");
    expect(tool.image).toBeUndefined();
  });

  it("offers a copyable install, key, path, and discovery workflow", () => {
    expect(tool.guideSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ step: 1, value: "curl -fsSL https://omp.sh/install | sh", copyable: true }),
      expect.objectContaining({ step: 2, type: "apiKeySelector" }),
      expect.objectContaining({ step: 3, value: "~/.omp/agent/models.yml", copyable: true }),
      expect.objectContaining({ step: 4, title: "Discover models in Oh My Pi" }),
    ]));
    expect(tool.guideSteps.map((step) => step.type).filter(Boolean)).toEqual(["apiKeySelector"]);
    expect(tool.guideSteps.some((step) => step.type === "modelSelector")).toBe(false);
  });

  it("pins the exact model-less OMP v18 discovery template", () => {
    expect(tool.codeBlock.language).toBe("yaml");
    expect(tool.codeBlock.code.trim()).toBe(expectedYaml);
    expect(tool.codeBlock.code).not.toContain("{{model}}");
    expect(tool.codeBlock.code).not.toContain("models:");
    expect(tool.codeBlock.code).not.toContain("modelRoles:");
  });

  it("uses the existing default guide route without any OMP writer or status adapter", () => {
    const detailSource = source("../../src/app/(dashboard)/dashboard/cli-tools/[toolId]/ToolDetailClient.js");
    const statusesSource = source("../../src/app/api/cli-tools/all-statuses/route.js");
    const ompRoute = fileURLToPath(new URL("../../src/app/api/cli-tools/omp/route.js", import.meta.url));

    expect(detailSource).toContain("default:");
    expect(detailSource).toContain("<DefaultToolCard");
    expect(detailSource).not.toContain('case "omp"');
    expect(statusesSource).not.toMatch(/["']omp["']/);
    expect(fs.existsSync(ompRoute)).toBe(false);
    expect(tool.settingsFile).toBeUndefined();
    expect(tool.envVars).toBeUndefined();
    expect(tool.defaultModels).toBeUndefined();
  });
});
