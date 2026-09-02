import { describe, expect, it } from "vitest";
import { openaiToGeminiRequest } from "open-sse/translator/request/openai-to-gemini.js";

const base = (extra) => ({ messages: [{ role: "user", content: "hi" }], ...extra });

const SCHEMA = {
  type: "object",
  properties: { name: { type: "string" }, summary: { type: "string" } },
  required: ["name", "summary"],
  additionalProperties: false,
};

// A client asking for OpenAI structured outputs on a Gemini route got ordinary
// prose back: response_format had no mapping onto generationConfig at all, so
// the request was silently downgraded to an unconstrained completion (#2003).
describe("openai response_format maps onto Gemini generationConfig (#2003)", () => {
  it("json_schema sets both the mime type and the schema", () => {
    const out = openaiToGeminiRequest("gemini-2.5-pro", base({
      response_format: { type: "json_schema", json_schema: { name: "t", strict: true, schema: SCHEMA } },
    }));
    expect(out.generationConfig.responseMimeType).toBe("application/json");
    expect(out.generationConfig.responseSchema.type).toBe("object");
    expect(Object.keys(out.generationConfig.responseSchema.properties)).toEqual(["name", "summary"]);
  });

  it("the caller's schema is not mutated", () => {
    // The cleaner mutates in place and a combo reuses one body across members,
    // so cleaning the caller's object would hand the next provider a
    // Gemini-shaped schema. additionalProperties is a keyword the cleaner
    // strips, which makes it the witness.
    const schema = JSON.parse(JSON.stringify(SCHEMA));
    const body = base({ response_format: { type: "json_schema", json_schema: { schema } } });
    openaiToGeminiRequest("gemini-2.5-pro", body);
    expect(schema).toEqual(SCHEMA);
    expect(schema.additionalProperties).toBe(false);
  });

  it("json_object asks for JSON without inventing a schema", () => {
    const out = openaiToGeminiRequest("gemini-2.5-pro", base({ response_format: { type: "json_object" } }));
    expect(out.generationConfig.responseMimeType).toBe("application/json");
    expect(out.generationConfig.responseSchema).toBeUndefined();
  });

  it("no response_format leaves generationConfig untouched", () => {
    const out = openaiToGeminiRequest("gemini-2.5-pro", base({ temperature: 0.5 }));
    expect(out.generationConfig.responseMimeType).toBeUndefined();
    expect(out.generationConfig.responseSchema).toBeUndefined();
    expect(out.generationConfig.temperature).toBe(0.5);
  });

  it("a malformed json_schema falls through rather than sending a null schema", () => {
    const out = openaiToGeminiRequest("gemini-2.5-pro", base({
      response_format: { type: "json_schema", json_schema: {} },
    }));
    expect(out.generationConfig.responseSchema).toBeUndefined();
    expect(out.generationConfig.responseMimeType).toBeUndefined();
  });
});
