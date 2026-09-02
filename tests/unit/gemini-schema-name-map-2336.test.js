import { describe, it, expect } from "vitest";
import { cleanJSONSchemaForAntigravity } from "../../open-sse/translator/formats/gemini.js";

// Issue #2336 and its duplicates (#2902 #2877 #2489 #2884 #2199). The schema
// cleaner walked `properties` as if it were a schema node, so a tool whose
// parameter happened to be named after a JSON Schema keyword came out of the
// translator with a different signature than the client sent, and Gemini
// answered with `Invalid value at ...properties[N].value, "object"`.

const clean = (s) => cleanJSONSchemaForAntigravity(structuredClone(s));
const wrap = (properties) => ({ type: "object", properties });

describe("gemini schema cleaner treats properties as a name map (#2336)", () => {
  it("does not turn an empty properties map into a schema", () => {
    // The canonical trigger: a property that is itself an object schema with an
    // empty properties map, beside an anyOf that flattens away.
    const out = clean(wrap({
      tags: {
        properties: {},
        anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }],
      },
    }));

    expect(out.properties.tags.properties).toEqual({});
    expect(out.properties.tags.properties).not.toHaveProperty("type");
    expect(out.properties.tags.properties).not.toHaveProperty("reason");
  });

  for (const name of ["const", "enum", "type", "items", "required", "anyOf", "oneOf", "allOf", "properties", "description"]) {
    it(`keeps a parameter named ${name} as a parameter`, () => {
      const out = clean(wrap({ [name]: { type: "string", description: `the ${name}` } }));

      expect(Object.keys(out.properties)).toContain(name);
      expect(out.properties[name].type).toBe("string");
      expect(out.properties[name].description).toBe(`the ${name}`);
    });
  }

  it("does not read a parameter named const as the const keyword", () => {
    const out = clean(wrap({ const: { type: "string" } }));
    expect(out.properties).toHaveProperty("const");
    expect(out.properties.const).toEqual({ type: "string" });
  });

  it("does not inject type:string into a parameter map holding a key named enum", () => {
    const out = clean(wrap({ enum: { type: "number" } }));
    expect(out.properties.enum.type).toBe("number");
  });

  it("still applies the placeholder to a genuinely empty object schema", () => {
    const out = clean({ type: "object", properties: {} });
    expect(out.properties).toHaveProperty("reason");
    expect(out.required).toEqual(["reason"]);
  });

  it("still converts a real const keyword to an enum", () => {
    const out = clean(wrap({ mode: { const: "fast" } }));
    expect(out.properties.mode.enum).toEqual(["fast"]);
    expect(out.properties.mode).not.toHaveProperty("const");
  });

  it("is idempotent", () => {
    const schema = wrap({
      const: { type: "string" },
      tags: { properties: {}, anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
      mode: { const: "fast" },
    });
    const once = clean(schema);
    expect(cleanJSONSchemaForAntigravity(structuredClone(once))).toEqual(once);
  });
});
