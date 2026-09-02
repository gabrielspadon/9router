import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const route = read("../../src/app/api/cli-tools/codex-settings/route.js");
const card = read("../../src/app/(dashboard)/dashboard/cli-tools/components/CodexToolCard.js");

// Recent Codex CLI versions refuse a role with no description and log
// "agent role `subagent` must define a description", so the section TokenProxy
// wrote was ignored and the subagent silently fell back to the main model
// (#1454).
describe("the generated Codex subagent role carries a description (#1454)", () => {
  it("the section writes one", () => {
    expect(route).toContain('description: "General-purpose subagent routed through TokenProxy."');
  });

  it("the manual copy-paste config carries it too", () => {
    // A user following the card's own instructions produced a config Codex
    // refused, because only the routed path wrote the description.
    expect(card).toContain('description = "General-purpose subagent routed through TokenProxy."');
  });

  it("model stays the first key, because the dashboard parses this section", () => {
    const i = route.indexOf('setNestedSection(parsed, "agents.subagent"');
    const block = route.slice(i, i + 300);
    expect(block.indexOf("model:")).toBeLessThan(block.indexOf("description:"));
  });

  it("the card's parse no longer depends on model being the first line", () => {
    // The old regex required `model` on the line straight after the header, so
    // adding any key above it would have silently stopped the UI finding it.
    expect(card).not.toContain('\\[agents\\.subagent\\]\\s*\\n\\s*model');
    expect(card).toContain("[agents\\.subagent\\]([\\s\\S]*?)(?=\\n\\[|$)");
  });
});

// The regex the card uses, exercised directly against both orderings and
// against a following section, which is what the lookahead is for.
describe("the subagent model parse tolerates key order", () => {
  const parse = (config) =>
    config.match(/\[agents\.subagent\]([\s\S]*?)(?=\n\[|$)/)?.[1]?.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1];

  it("finds the model when description comes second", () => {
    expect(parse('[agents.subagent]\nmodel = "gpt-5.6"\ndescription = "d"\n')).toBe("gpt-5.6");
  });

  it("finds the model when description comes first", () => {
    expect(parse('[agents.subagent]\ndescription = "d"\nmodel = "gpt-5.6"\n')).toBe("gpt-5.6");
  });

  it("does not read a model out of the next section", () => {
    expect(parse('[agents.subagent]\ndescription = "d"\n\n[model_providers.tokenproxy]\nmodel = "wrong"\n')).toBeUndefined();
  });

  it("returns nothing when the section is absent", () => {
    expect(parse('[model_providers.tokenproxy]\nmodel = "x"\n')).toBeUndefined();
  });
});
