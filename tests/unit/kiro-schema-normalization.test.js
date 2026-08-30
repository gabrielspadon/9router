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

  it("preserves keyword-shaped names in root and nested property maps", () => {
    const out = specSchema({
      properties: {
        title: { type: "string", title: "strip schema title" },
        $schema: { type: "number", $schema: "strip schema id" },
        default: { type: "boolean", default: "strip schema default" },
        nested: {
          type: "object",
          properties: {
            additionalProperties: { type: "string", additionalProperties: false },
            $id: { type: "integer", $id: "strip nested id" },
            examples: { type: "null", examples: ["strip nested examples"] },
            required: { type: "object", required: [] },
          },
        },
      },
      required: ["title", "$schema", "default", "nested"],
    });

    expect(out.properties).toEqual({
      title: { type: "string" },
      $schema: { type: "number" },
      default: { type: "boolean" },
      nested: {
        type: "object",
        properties: {
          additionalProperties: { type: "string" },
          $id: { type: "integer" },
          examples: { type: "null" },
          required: { type: "object" },
        },
      },
    });
    expect(out.required).toEqual(["title", "$schema", "default", "nested"]);
  });

  it("preserves keyword-shaped definition names and their surviving references", () => {
    const out = specSchema({
      $defs: {
        title: { type: "string", title: "strip definition title" },
        $schema: { type: "number", $schema: "strip definition schema" },
        default: { type: "boolean", default: "strip definition default" },
      },
      definitions: {
        $id: { type: "integer", $id: "strip legacy id" },
        examples: { type: "null", examples: ["strip legacy examples"] },
      },
      properties: {
        fromTitle: { $ref: "#/$defs/title" },
        fromSchema: { $ref: "#/$defs/$schema" },
        fromDefault: { $ref: "#/$defs/default" },
        fromId: { $ref: "#/definitions/$id" },
        fromExamples: { $ref: "#/definitions/examples" },
      },
    });

    expect(out.$defs).toEqual({
      title: { type: "string" },
      $schema: { type: "number" },
      default: { type: "boolean" },
    });
    expect(out.definitions).toEqual({
      $id: { type: "integer" },
      examples: { type: "null" },
    });
    expect(out.properties.fromTitle).toEqual({ $ref: "#/$defs/title" });
    expect(out.properties.fromSchema).toEqual({ $ref: "#/$defs/$schema" });
    expect(out.properties.fromDefault).toEqual({ $ref: "#/$defs/default" });
    expect(out.properties.fromId).toEqual({ $ref: "#/definitions/$id" });
    expect(out.properties.fromExamples).toEqual({ $ref: "#/definitions/examples" });
  });

  it("clones object-valued enum and const data byte-for-byte", () => {
    const enumValue = {
      title: "literal enum title",
      $schema: "literal enum schema",
      required: [],
      nested: { default: "literal enum default", additionalProperties: false },
    };
    const constValue = {
      $id: "literal const id",
      examples: [{ title: "literal nested title" }],
      required: [],
      nested: [{ default: "literal nested default" }],
    };
    const source = {
      properties: {
        choice: {
          type: "object",
          enum: [enumValue],
          const: constValue,
          required: [],
        },
      },
    };
    const before = JSON.stringify(source);
    const out = specSchema(source);

    expect(JSON.stringify(out.properties.choice.enum[0])).toBe(JSON.stringify(enumValue));
    expect(JSON.stringify(out.properties.choice.const)).toBe(JSON.stringify(constValue));
    expect(out.properties.choice.required).toBeUndefined();
    expect(JSON.stringify(source)).toBe(before);
  });

  it("still strips real schema keywords at root and nested schema nodes", () => {
    expect(specSchema({
      title: "strip root title",
      $schema: "strip root schema",
      $id: "strip root id",
      examples: ["strip root examples"],
      default: "strip root default",
      additionalProperties: false,
      properties: {
        nested: {
          type: "object",
          title: "strip nested title",
          $schema: "strip nested schema",
          $id: "strip nested id",
          examples: ["strip nested examples"],
          default: "strip nested default",
          additionalProperties: false,
          properties: {
            leaf: {
              type: "string",
              title: "strip leaf title",
              $schema: "strip leaf schema",
              $id: "strip leaf id",
              examples: ["strip leaf examples"],
              default: "strip leaf default",
              additionalProperties: false,
            },
          },
        },
      },
    })).toEqual({
      type: "object",
      properties: {
        nested: {
          type: "object",
          properties: {
            leaf: { type: "string" },
          },
        },
      },
    });
  });
});
