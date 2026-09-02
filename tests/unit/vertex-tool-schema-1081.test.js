import { describe, expect, it } from "vitest";
import { openaiToVertexRequest } from "open-sse/translator/request/openai-to-vertex.js";

// #1081 reports Vertex rejecting an entire request with
//   Invalid value at 'tools[0].function_declarations[37].parameters.properties[9].value'
//   (type.googleapis.com/google.cloud.aiplatform.v1.Schema), "object"
// which is the exact error shape #1564 already fixed: a tool schema property whose
// value is a bare string ("object") rather than a nested Schema object. #1081 predates
// that fix landing, and openaiToVertexRequest routes every tool's parameters through
// openaiToGeminiRequest -> cleanJSONSchemaForAntigravity, which now repairs it before
// the request ever reaches Vertex. This is the end-to-end path #1081's reporter hit
// (a Claude Code client on a "vx/" model), not just the schema-cleaner unit already
// covered by gemini-schema-string-property-1564.test.js.
describe("Vertex tool schema survives translation without a malformed property (#1081)", () => {
  it("repairs a bare-string property value across many tools, matching the reported tool at index 37", () => {
    const tools = [];
    for (let i = 0; i < 40; i++) {
      tools.push({
        type: "function",
        function: {
          name: `tool_${i}`,
          description: "",
          parameters: {
            type: "object",
            properties: i === 37 ? { good: { type: "string" }, bad: "object" } : { a: { type: "string" } },
          },
        },
      });
    }

    const out = openaiToVertexRequest(
      "gemini-3.1-flash-lite-preview",
      { messages: [{ role: "user", content: "hi" }], tools },
      false,
      null
    );

    const decls = out.tools[0].functionDeclarations;
    expect(decls).toHaveLength(40);
    for (const decl of decls) {
      for (const value of Object.values(decl.parameters.properties)) {
        // Every property value must be a real schema object, never the bare
        // string Vertex's proto validator rejects the whole request over.
        expect(typeof value).toBe("object");
        expect(value).not.toBeNull();
      }
    }
    expect(decls[37].parameters.properties.bad).toMatchObject({ type: "object" });
  });

  it("accepts a Claude-shaped tool (name/input_schema), the other shape Claude Code sends", () => {
    const out = openaiToVertexRequest(
      "gemini-3.1-flash-lite-preview",
      {
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: "read_file", description: "", input_schema: { type: "object", properties: { path: "string" } } }],
      },
      false,
      null
    );
    const props = out.tools[0].functionDeclarations[0].parameters.properties;
    expect(props.path).toMatchObject({ type: "string" });
  });
});
