import { describe, expect, it } from "vitest";
import { normalizeKiroToolSpecs } from "../../open-sse/translator/concerns/kiroConversation.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";

const MODEL = "claude-sonnet-4.6";

function specSchema(schema) {
  const { specs } = normalizeKiroToolSpecs([{
    name: "demo",
    description: "Demo tool",
    input_schema: schema,
  }]);
  expect(specs).toHaveLength(1);
  return specs[0].toolSpecification.inputSchema.json;
}

function translatedSchema(result) {
  return result.conversationState.currentMessage.userInputMessage
    .userInputMessageContext.tools[0].toolSpecification.inputSchema.json;
}

function schemaProperties(entries) {
  return Object.fromEntries(entries);
}

function recursiveSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "strip root title",
    type: "object",
    $defs: {
      RootValue: { type: "string", title: "strip definition title", $id: "urn:root" },
    },
    properties: schemaProperties([
      ["rootOnly", { type: "string", default: "strip default" }],
      ["conflict", { type: "string" }],
      ["commonOne", { type: "string" }],
      ["commonAny", { type: "string" }],
      ["nested", { anyOf: [{ type: "string", title: "strip nested title" }, { type: "number" }] }],
      ["__proto__", { type: "string" }],
    ]),
    required: ["rootOnly", "ghost", 42],
    allOf: [{
      properties: {
        nestedAll: { type: "number" },
        branchConflict: { type: "string" },
      },
      required: ["nestedAll", "cross"],
      allOf: [{
        $defs: {
          BranchValue: { type: "integer", examples: [1] },
        },
        properties: {
          cross: { type: "integer" },
          fromDef: { $ref: "#/$defs/BranchValue" },
          conflict: { type: "boolean" },
          branchConflict: { type: "boolean" },
        },
        required: ["cross"],
      }],
    }],
    oneOf: [
      {
        properties: {
          variantA: { type: "string" },
          conflict: { type: "number" },
          alternativeConflict: { const: "oneOf" },
        },
        required: ["commonOne", "variantA"],
      },
      {
        properties: { variantB: { type: "number" } },
        required: ["commonOne", "variantB"],
      },
    ],
    anyOf: [
      {
        properties: {
          optionalA: { type: "boolean" },
          alternativeConflict: { const: "anyOf" },
        },
        required: ["commonAny", "optionalA"],
      },
      {
        properties: { optionalB: { type: "string" } },
        required: ["commonAny", "optionalB"],
      },
    ],
    additionalProperties: false,
  };
}

describe("Kiro root schema normalization", () => {
  it("preserves supported non-composition keywords and removes empty required", () => {
    expect(specSchema({
      description: "keep root description",
      minProperties: 1,
      properties: {
        value: {
          type: "string",
          description: "keep property description",
          enum: ["a", "b"],
          title: "strip property title",
        },
      },
      required: [],
    })).toEqual({
      description: "keep root description",
      minProperties: 1,
      type: "object",
      properties: {
        value: {
          type: "string",
          description: "keep property description",
          enum: ["a", "b"],
        },
      },
    });
  });

  it("recursively folds root composition with deterministic properties and requirements", () => {
    const out = specSchema(recursiveSchema());

    expect(Object.keys(out.properties)).toEqual([
      "rootOnly", "conflict", "commonOne", "commonAny", "nested", "__proto__",
      "nestedAll", "branchConflict", "cross", "fromDef", "variantA",
      "alternativeConflict", "variantB", "optionalA", "optionalB",
    ]);
    expect(out.required).toEqual([
      "rootOnly", "nestedAll", "cross", "commonOne", "commonAny",
    ]);
    expect(out.properties.conflict).toEqual({ type: "string" });
    expect(out.properties.branchConflict).toEqual({ type: "string" });
    expect(out.properties.alternativeConflict).toEqual({ const: "oneOf" });
    expect(out.properties.nested).toEqual({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
    expect(out.properties.fromDef).toEqual({ $ref: "#/$defs/BranchValue" });
    expect(out.$defs).toEqual({
      RootValue: { type: "string" },
      BranchValue: { type: "integer" },
    });
    expect(out).not.toHaveProperty("allOf");
    expect(out).not.toHaveProperty("oneOf");
    expect(out).not.toHaveProperty("anyOf");
    expect(JSON.stringify(out)).not.toMatch(/additionalProperties|\$schema|\$id|examples|default|title/);
    expect(Object.hasOwn(out.properties, "__proto__")).toBe(true);
  });

  it("counts empty and reference-only alternatives when intersecting required names", () => {
    const withEmpty = specSchema({
      properties: { common: { type: "string" }, branch: { type: "number" } },
      oneOf: [
        { properties: { branch: { type: "number" } }, required: ["common", "branch"] },
        {},
      ],
    });
    const withReference = specSchema({
      $defs: { Other: { type: "object", properties: { other: { type: "string" } } } },
      properties: { common: { type: "string" } },
      anyOf: [
        { required: ["common"] },
        { $ref: "#/$defs/Other" },
      ],
    });

    expect(withEmpty.required).toBeUndefined();
    expect(withReference.required).toBeUndefined();
    expect(withReference).not.toHaveProperty("$ref");
    expect(withReference.$defs.Other.properties.other).toEqual({ type: "string" });
  });

  it("preserves a root reference but never lifts a consumed branch reference", () => {
    const out = specSchema({
      $ref: "#/$defs/Input",
      $defs: { Input: { type: "object", properties: { root: { type: "string" } } } },
      allOf: [
        { $ref: "#/$defs/Input" },
        {
          definitions: { Local: { type: "number", title: "strip" } },
          properties: { local: { $ref: "#/definitions/Local" } },
        },
      ],
    });

    expect(out.$ref).toBe("#/$defs/Input");
    expect(out.properties.local).toEqual({ $ref: "#/definitions/Local" });
    expect(out.definitions).toEqual({ Local: { type: "number" } });
  });

  it.each([null, "not-a-schema", 42, [], true])(
    "falls back to an empty object schema for %j",
    (source) => {
      expect(specSchema(source)).toEqual({ type: "object", properties: {} });
    },
  );

  it("skips invalid combinator members and prunes malformed required entries", () => {
    expect(specSchema({
      properties: { kept: { type: "string" } },
      required: ["kept", "missing", 7, "kept"],
      allOf: [null, "bad", 9, [], { required: ["alsoMissing"] }],
      oneOf: [false, { properties: { alternative: { type: "number" } } }],
    })).toEqual({
      type: "object",
      properties: { kept: { type: "string" }, alternative: { type: "number" } },
      required: ["kept"],
    });
  });

  it("is deterministic, idempotent, and shares no mutable schema references", () => {
    const source = recursiveSchema();
    const before = JSON.stringify(source);
    const first = specSchema(source);
    const second = specSchema(source);
    const normalizedAgain = specSchema(first);

    expect(first).toEqual(second);
    expect(normalizedAgain).toEqual(first);
    expect(JSON.stringify(source)).toBe(before);
    first.properties.nested.anyOf[0].type = "boolean";
    expect(source.properties.nested.anyOf[0].type).toBe("string");
  });

  it("normalizes the same schema through both real request translators", () => {
    const schema = recursiveSchema();
    const openaiBody = {
      messages: [{ role: "user", content: "run the demo" }],
      tools: [{
        type: "function",
        function: { name: "demo", description: "Demo tool", parameters: schema },
      }],
    };
    const claudeBody = {
      messages: [{ role: "user", content: "run the demo" }],
      tools: [{ name: "demo", description: "Demo tool", input_schema: schema }],
    };
    const before = JSON.stringify({ openaiBody, claudeBody });

    const openai = translatedSchema(openaiToKiroRequest(MODEL, openaiBody, true, {}));
    const claude = translatedSchema(claudeToKiroRequest(MODEL, claudeBody, true, {}));

    expect(openai).toEqual(specSchema(schema));
    expect(claude).toEqual(openai);
    expect(JSON.stringify({ openaiBody, claudeBody })).toBe(before);
  });
});
