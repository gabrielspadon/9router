import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FORMATS, detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { PROVIDERS } from "open-sse/config/providers.js";

const chatCore = readFileSync(new URL("../../open-sse/handlers/chatCore.js", import.meta.url), "utf8");

// The Responses API takes reasoning.effort nested; a flat reasoning_effort is
// rejected. The passthrough path nested it only when the provider was literally
// "codex", so the official OpenAI provider — a distinct registry entry serving
// the same API — got the flat field and answered 400 on gpt-5.6 (#3154).
describe("reasoning_effort is nested by wire format, not by provider (#3154)", () => {
  it("the guard keys on the format constant", () => {
    expect(chatCore).toContain("if (targetFormat === FORMATS.OPENAI_RESPONSES) {");
    // The provider-name test is what excluded openai; it must be gone, not
    // merely supplemented, or the narrow branch still wins.
    expect(chatCore).not.toContain('if (provider === "codex") {\n      const suffixThinking');
  });

  it("it still deletes the flat field after nesting", () => {
    const guard = chatCore.indexOf("if (targetFormat === FORMATS.OPENAI_RESPONSES) {");
    const del = chatCore.indexOf("delete translatedBody.reasoning_effort;", guard);
    const nest = chatCore.indexOf("effort: suffixThinking.reasoning_effort,", guard);
    expect(nest).toBeGreaterThan(guard);
    expect(del).toBeGreaterThan(nest);
  });

  it("it preserves a reasoning object the client already sent", () => {
    // Spreading rather than replacing matters: a Responses client may send
    // reasoning.summary alongside, and clobbering it loses the summary.
    const guard = chatCore.indexOf("if (targetFormat === FORMATS.OPENAI_RESPONSES) {");
    expect(chatCore.slice(guard, guard + 700)).toContain("...(reasoning &&");
  });

  it("/v1/responses really does resolve to the format the guard names", () => {
    expect(detectFormatByEndpoint("/v1/responses", {})).toBe(FORMATS.OPENAI_RESPONSES);
  });

  it("codex is still covered by the widened guard", () => {
    // codex declares the Responses format at provider level, so every request
    // that used to match `provider === "codex"` still matches the format test.
    expect(PROVIDERS.codex.format).toBe(FORMATS.OPENAI_RESPONSES);
  });

  it("openai is a separate provider, which is why the old guard missed it", () => {
    // It reaches the same branch through passthrough when the client posts to
    // /v1/responses, and the provider-name test could never match.
    expect(PROVIDERS.openai).toBeDefined();
    expect(PROVIDERS.openai.format).not.toBe(FORMATS.OPENAI_RESPONSES);
  });
});
