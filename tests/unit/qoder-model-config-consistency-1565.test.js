import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const exec = readFileSync(new URL("../../open-sse/executors/qoder.js", import.meta.url), "utf8");
const catalog = readFileSync(new URL("../../open-sse/services/qoderModels.js", import.meta.url), "utf8");

// Every qd/* model answered as Qwen regardless of the one selected (#1565). The
// catalog fetcher documents the mechanism: Qoder's chat endpoint silently
// downgrades to a different model when the wrong model_config is sent. The
// payload described the choice TWICE — once in full at model_config, once
// reduced to key + is_reasoning inside chat_context.extra — so the two could
// disagree about which model was wanted.
describe("qoder sends one consistent model_config (#1565)", () => {
  it("the documented failure mode is the one being fixed", () => {
    // Quoted from the catalog fetcher, so this test fails loudly if that
    // contract note is ever removed or contradicted.
    expect(catalog).toContain("silently downgrades to a different model");
  });

  it("the nested copy carries the full server block, not a stub", () => {
    expect(exec).toContain("modelConfig: { ...modelConfig, key: qoderKey, is_reasoning: isReasoning },");
    expect(exec).not.toContain("modelConfig: { key: qoderKey, is_reasoning: isReasoning },");
  });

  it("the top-level model_config still carries the server block unchanged", () => {
    expect(exec).toContain("model_config: modelConfig,");
  });

  it("key and is_reasoning keep the values they had", () => {
    // The stub set exactly these two; spreading must not drop or change them.
    const i = exec.indexOf("modelConfig: { ...modelConfig,");
    const line = exec.slice(i, i + 90);
    expect(line).toContain("key: qoderKey");
    expect(line).toContain("is_reasoning: isReasoning");
  });

  it("no top-level model selector was invented", () => {
    // The re-triage proposed adding a literal model/model_id field. The catalog
    // note says selection goes through model_config, so an invented top-level
    // field would be a guess at a contract that is already documented here.
    const payload = exec.slice(exec.indexOf("payload: {"), exec.indexOf("business: {"));
    expect(payload).not.toMatch(/^\s+model:\s/m);
    expect(payload).not.toMatch(/^\s+model_id:\s/m);
  });

  it("the config still comes from the server catalog, keyed by the requested model", () => {
    expect(exec).toContain("modelConfig = { ...retried, key: qoderKey };");
    expect(exec).toContain('const qoderKey = String(model || "").replace(/^qoder\\//, "");');
  });
});
