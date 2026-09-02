import { describe, expect, it } from "vitest";
import { cleanJSONSchemaForAntigravity } from "open-sse/translator/formats/gemini.js";

// Vertex rejected the WHOLE request with
//   Invalid value at 'request.tools[0].function_declarations[28]
//   .parameters.properties[6].value' (Schema), "object"
// so one malformed property made every Claude Code request through Antigravity
// fail, on every model (#1564). The property's value was a bare string where a
// schema object belongs — tolerated by Anthropic and OpenAI, fatal to Vertex.
describe("a property whose value is not a schema is repaired (#1564)", () => {
  it("a known type name becomes the schema it was meant to be", () => {
    const out = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: { good: { type: "string" }, bad: "object" },
    });
    // toMatchObject, not toEqual: an empty object schema is later given a
    // placeholder property by addPlaceholders, which Antigravity requires.
    expect(out.properties.bad).toMatchObject({ type: "object" });
    expect(out.properties.good).toMatchObject({ type: "string" });
  });

  it("every JSON Schema type name is accepted", () => {
    const props = {};
    for (const t of ["string", "number", "integer", "boolean", "object", "array"]) props[t] = t;
    const out = cleanJSONSchemaForAntigravity({ type: "object", properties: props });
    for (const t of ["string", "number", "integer", "boolean", "object", "array"]) {
      expect(out.properties[t]).toMatchObject({ type: t });
    }
  });

  it("an unusable value is dropped rather than guessed at", () => {
    const out = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: { keep: { type: "string" }, junk: "not-a-type", n: 42, nil: null },
    });
    expect(out.properties).toHaveProperty("keep");
    expect(out.properties).not.toHaveProperty("junk");
    expect(out.properties).not.toHaveProperty("n");
    expect(out.properties).not.toHaveProperty("nil");
  });

  it("dropping a property also drops it from required", () => {
    // Leaving it would trade this rejection for a different one: required
    // naming a property that no longer exists.
    const out = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: { keep: { type: "string" }, junk: "not-a-type" },
      required: ["keep", "junk"],
    });
    expect(out.required).toEqual(["keep"]);
  });

  it("it reaches nested properties, not just the top level", () => {
    const out = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: { outer: { type: "object", properties: { inner: "boolean" } } },
    });
    expect(out.properties.outer.properties.inner).toMatchObject({ type: "boolean" });
  });

  it("a property legitimately NAMED like a keyword is untouched", () => {
    // Property names live in a map, so a property called "type" or "properties"
    // must not be treated as a schema keyword.
    const out = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: { type: { type: "string" }, properties: { type: "array" } },
    });
    expect(out.properties.type).toMatchObject({ type: "string" });
    expect(out.properties.properties).toMatchObject({ type: "array" });
  });

  it("a well-formed schema is unchanged by the new phase", () => {
    const out = cleanJSONSchemaForAntigravity({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "array", items: { type: "number" } } },
      required: ["a"],
    });
    expect(out.properties.a).toMatchObject({ type: "string" });
    expect(out.properties.b.items).toMatchObject({ type: "number" });
    expect(out.required).toEqual(["a"]);
  });
});
