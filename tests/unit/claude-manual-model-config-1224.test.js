import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const card = readFileSync(new URL("../../src/app/(dashboard)/dashboard/cli-tools/components/ClaudeToolCard.js", import.meta.url), "utf8");

// Manual configuration is the primary workflow on a remote deployment, and when
// the Claude CLI was not detected locally the generated config carried only
// ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN, with the model pickers hidden
// entirely (#1224).
describe("model selection works without a local Claude CLI (#1224)", () => {
  it("the generator already emitted a var per mapped model", () => {
    // Nothing was missing downstream; the mappings simply never got populated.
    expect(card).toContain("if (targetModel && model.envKey) env[model.envKey] = targetModel;");
  });

  it("mappings are seeded whether or not the CLI was detected", () => {
    expect(card).toContain("if (claudeStatus && !hasInitializedModels.current) {");
    expect(card).not.toContain("if (claudeStatus?.installed && !hasInitializedModels.current) {");
  });

  it("with no settings file it falls back to the declared defaults", () => {
    // There is nothing to read values FROM in that case, so defaultValue is
    // what makes the seeded mapping non-empty.
    expect(card).toContain("const value = env[model.envKey] || model.defaultValue || \"\";");
  });

  it("the pickers render in the not-detected branch too", () => {
    const notDetected = card.indexOf("Claude CLI not detected locally");
    const detected = card.indexOf("{!checkingClaude && claudeStatus?.installed && (");
    const pickerInBranch = card.indexOf("tool.defaultModels.map", notDetected);
    expect(notDetected).toBeGreaterThan(0);
    expect(pickerInBranch).toBeGreaterThan(notDetected);
    expect(pickerInBranch).toBeLessThan(detected);
  });

  it("both branches use the same mapping state, so the config picks it up", () => {
    const uses = card.match(/value=\{modelMappings\[model\.alias\] \|\| ""\}/g) || [];
    expect(uses.length).toBe(2);
  });

  it("Select Model stays disabled without an active provider", () => {
    // Same guard as the detected branch: there is nothing to choose from.
    // Three sites in total — the two pickers plus the Apply button.
    const uses = card.match(/disabled=\{!hasActiveProviders\}/g) || [];
    expect(uses.length).toBe(3);
    const notDetected = card.indexOf("Claude CLI not detected locally");
    const guardInBranch = card.indexOf("disabled={!hasActiveProviders}", notDetected);
    expect(guardInBranch).toBeGreaterThan(notDetected);
  });
});
