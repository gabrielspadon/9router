import { describe, expect, it } from "vitest";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

// Issue #3622. Gemini caps a function name at 64 characters and the sanitizer
// simply truncated, so two MCP tools sharing a long prefix collapsed into one
// declaration and a call against it could not be resolved back to either. Long
// names are now disambiguated with a tag derived from the whole original, and
// the mapping rides back on _toolNameMap, which chatCore hands to the response
// side.

// A shared prefix longer than the 64-character cap, so plain truncation makes
// these two names identical. Asserted below, because a test whose inputs do not
// actually collide proves nothing about a collision fix.
const SHARED = `mcp__acme__${"segment_".repeat(8)}`;
const LONG_A = `${SHARED}alpha`;
const LONG_B = `${SHARED}beta`;

const withTools = (names) => openaiToGeminiRequest("gemini-2.5-pro", {
  messages: [{ role: "user", content: "hi" }],
  tools: names.map((n) => ({ type: "function", function: { name: n, parameters: { type: "object", properties: {} } } })),
}, true);

const declared = (out) => (out.tools?.[0]?.functionDeclarations || []).map((d) => d.name);

describe("Gemini function name collisions (#3622)", () => {
  it("uses inputs that genuinely collide under plain truncation", () => {
    expect(SHARED.length).toBeGreaterThan(64);
    expect(LONG_A.slice(0, 64)).toBe(LONG_B.slice(0, 64));
  });

  it("keeps two long names that share a 64-char prefix distinct", () => {
    const names = declared(withTools([LONG_A, LONG_B]));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it("keeps every emitted name inside Gemini's 64-character limit", () => {
    for (const n of declared(withTools([LONG_A, LONG_B]))) {
      expect(n.length).toBeLessThanOrEqual(64);
    }
  });

  it("maps each emitted name back to the one the client declared", () => {
    const out = withTools([LONG_A, LONG_B]);
    const names = declared(out);
    expect(out._toolNameMap).toBeInstanceOf(Map);
    expect(out._toolNameMap.get(names[0])).toBe(LONG_A);
    expect(out._toolNameMap.get(names[1])).toBe(LONG_B);
  });

  it("is deterministic, so a redeclared tool keeps the same name", () => {
    expect(declared(withTools([LONG_A]))).toEqual(declared(withTools([LONG_A])));
  });

  it("leaves a short name untouched and adds no map entry for it", () => {
    const out = withTools(["Bash"]);
    expect(declared(out)).toEqual(["Bash"]);
    expect(out._toolNameMap).toBeUndefined();
  });
});
