import { describe, expect, it } from "vitest";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";

// A tool converted from Claude to OpenAI carried its input_schema verbatim. The
// ABSENT case was handled, but a present-yet-malformed schema was forwarded and
// came back as "Invalid tool parameters" — which reads to the user as a broken
// file edit rather than a schema problem.
const params = (input_schema) =>
  claudeToOpenAIRequest("m", {
    model: "m",
    messages: [{ role: "user", content: "hi" }],
    tools: [{ name: "edit", description: "d", input_schema }],
  }, false).tools[0].function.parameters;

describe("a malformed Claude tool schema is normalized (#2875)", () => {
  it("fills in a missing type", () => {
    expect(params({ properties: { a: { type: "string" } } }).type).toBe("object");
  });

  it("fills in missing properties on an object schema", () => {
    expect(params({ type: "object" }).properties).toEqual({});
  });

  it("replaces a non-object schema entirely", () => {
    for (const bad of [null, undefined, "nope", 7, []]) {
      expect(params(bad), JSON.stringify(bad)).toEqual({ type: "object", properties: {} });
    }
  });

  it("leaves a well-formed schema alone", () => {
    const good = { type: "object", properties: { path: { type: "string" } }, required: ["path"] };
    expect(params(good)).toEqual(good);
  });

  it("keeps sibling keywords rather than rebuilding the schema", () => {
    const out = params({ properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false });
    expect(out.required).toEqual(["a"]);
    expect(out.additionalProperties).toBe(false);
  });

  it("does not mutate the caller's schema", () => {
    // A combo reuses one body across providers.
    const schema = { properties: {} };
    params(schema);
    expect(schema.type).toBeUndefined();
  });

  it("leaves a non-object schema type as declared", () => {
    // Only an object schema needs properties; an array schema must not gain one.
    expect(params({ type: "array", items: { type: "string" } }).properties).toBeUndefined();
  });
});
