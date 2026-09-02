import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FORMATS } from "open-sse/translator/formats.js";

const src = readFileSync(new URL("../../open-sse/utils/stream.js", import.meta.url), "utf8");

// `data: [DONE]` is an OpenAI convention. The Anthropic wire protocol does not
// have it: that stream ends at `event: message_stop`, and every frame on it
// carries an `event:` line, so a bare data-only frame arriving after the message
// has ended is one the SDK has no state for. Passthrough appended it to every
// stream whose provider was not Gemini-family, which included Claude clients.
describe("the OpenAI sentinel stays off Anthropic streams (#1733)", () => {
  it("passthrough skips it when the client speaks Claude", () => {
    expect(src).toContain("const clientSpeaksClaude = sourceFormat === FORMATS.CLAUDE;");
    expect(src).toContain("!isGeminiFamily && !clientSpeaksClaude");
  });

  it("the decision is made on the client format, not the provider", () => {
    // A Claude-speaking client in front of an OpenAI-compatible upstream is
    // exactly the case a provider check would get wrong.
    const i = src.indexOf("const clientSpeaksClaude");
    expect(src.slice(i, i + 120)).toContain("sourceFormat");
    expect(src.slice(i, i + 120)).not.toContain("provider ===");
  });

  it("the Gemini-family exclusion it sits beside is unchanged", () => {
    expect(src).toContain('provider === "antigravity" || provider === "gemini" || provider === "vertex"');
  });

  it("an OpenAI client still gets its sentinel", () => {
    // Some clients hang until timeout without it, which is why it is emitted at
    // all; the guard must not take it away from them.
    const i = src.indexOf("!isGeminiFamily && !clientSpeaksClaude");
    const block = src.slice(i, i + 400);
    expect(block).toContain('data: [DONE]\\n\\n');
    expect(FORMATS.OPENAI).not.toBe(FORMATS.CLAUDE);
  });
});
