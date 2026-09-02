import { describe, expect, it } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";

// OpenAI's strict JSON-schema validator rejects a regex lookaround outright:
// "Invalid JSON schema: regex lookaround is not supported. Found at
// $.properties.email.pattern." The client's schema was forwarded unchanged, so
// every call carrying such a tool failed with a 400 the user could not fix.
const toolWith = (pattern) => ({
  model: "gpt-5.5",
  messages: [{ role: "user", content: "hi" }],
  tools: [{
    type: "function",
    function: {
      name: "sendMail",
      parameters: {
        type: "object",
        properties: {
          email: { type: "string", pattern },
          note: { type: "string", pattern: "^[a-z]+$" },
        },
      },
    },
  }],
});
const out = (pattern) =>
  JSON.stringify(translateRequest("openai", "openai-responses", "gpt-5.5", toolWith(pattern), false, null, "codex"));

describe("a lookaround pattern does not 400 the request (#1556)", () => {
  it("drops a positive lookahead", () => {
    expect(out("^(?=.*@).+$")).not.toContain("(?=");
  });

  it("drops the other lookaround forms", () => {
    for (const p of ["a(?!b)", "(?<=x)y", "(?<!x)y"]) {
      expect(out(p), p).not.toContain(p);
    }
  });

  it("keeps a pattern the validator accepts", () => {
    expect(out("^(?=.*@).+$")).toContain("^[a-z]+$");
  });

  it("keeps the rest of the schema intact", () => {
    const s = out("^(?=.*@).+$");
    expect(s).toContain("sendMail");
    expect(s).toContain("email");
    expect(s).toContain("note");
  });

  it("does not mutate the caller's schema, which a combo reuses", () => {
    // A combo passes one body to several providers in turn; editing in place
    // would strip the pattern for a provider that accepts it.
    const body = toolWith("^(?=.*@).+$");
    translateRequest("openai", "openai-responses", "gpt-5.5", body, false, null, "codex");
    expect(body.tools[0].function.parameters.properties.email.pattern).toBe("^(?=.*@).+$");
  });

  it("leaves a schema with no lookaround completely untouched", () => {
    const body = toolWith("^[a-z]+$");
    const before = JSON.stringify(body.tools[0].function.parameters);
    translateRequest("openai", "openai-responses", "gpt-5.5", body, false, null, "codex");
    expect(JSON.stringify(body.tools[0].function.parameters)).toBe(before);
  });
});
