import { describe, expect, it } from "vitest";
import { prepareClaudeRequest } from "open-sse/translator/formats/claude.js";

// Claude Code writes the configured ANTHROPIC_DEFAULT_*_MODEL values into the
// Task tool's own schema, so a TokenProxy-namespaced id reached Anthropic and was
// rejected outright: {"message":"tools.36.model: cc/claude-opus-4-8"}. Every
// subagent dispatch failed (#2642). body.model is de-prefixed on the way
// through; a model sitting on a TOOL was not.
const req = (tools) => prepareClaudeRequest(
  { model: "claude-opus-4-8", messages: [{ role: "user", content: "hi" }], tools },
  "claude",
);

describe("a TokenProxy alias is stripped from a tool's model (#2642)", () => {
  it("the reported value is de-prefixed", () => {
    const out = req([{ name: "Task", description: "d", input_schema: { type: "object" }, model: "cc/claude-opus-4-8" }]);
    expect(out.tools[0].model).toBe("claude-opus-4-8");
  });

  it("the rest of the tool is untouched", () => {
    const out = req([{ name: "Task", description: "d", input_schema: { type: "object" }, model: "cc/claude-sonnet-5" }]);
    expect(out.tools[0].name).toBe("Task");
    expect(out.tools[0].description).toBe("d");
  });

  it("a bare model with no prefix is left alone", () => {
    const out = req([{ name: "Task", input_schema: { type: "object" }, model: "claude-opus-4-8" }]);
    expect(out.tools[0].model).toBe("claude-opus-4-8");
  });

  it("a prefix this router does not own is left alone", () => {
    // Only a known alias or provider id is stripped, so a value that merely
    // contains a slash keeps its shape.
    const out = req([{ name: "Task", input_schema: { type: "object" }, model: "some-vendor/their-model" }]);
    expect(out.tools[0].model).toBe("some-vendor/their-model");
  });

  it("a tool without a model is unaffected", () => {
    const out = req([{ name: "Read", description: "d", input_schema: { type: "object" } }]);
    expect(out.tools[0]).not.toHaveProperty("model");
    expect(out.tools[0].name).toBe("Read");
  });

  it("several tools are each handled", () => {
    const out = req([
      { name: "A", input_schema: { type: "object" }, model: "cc/claude-haiku-4-5-20251001" },
      { name: "B", input_schema: { type: "object" } },
      { name: "C", input_schema: { type: "object" }, model: "claude-fable-5" },
    ]);
    expect(out.tools[0].model).toBe("claude-haiku-4-5-20251001");
    expect(out.tools[2].model).toBe("claude-fable-5");
  });

  it("a non-string model is not coerced", () => {
    const out = req([{ name: "Task", input_schema: { type: "object" }, model: 42 }]);
    expect(out.tools[0].model).toBe(42);
  });
});
