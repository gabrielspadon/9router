import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../open-sse/handlers/chatCore/nonStreamingHandler.js", import.meta.url), "utf8");

// A provider that answers with SSE but is not flagged forceStream (kiro, cursor)
// reaches the non-streaming handler, which parses the SSE into an OpenAI chat
// completion. The body is then no longer in targetFormat, but the translation
// step still claimed it was, so the target->source translator received a body it
// could not read and the client got the raw OpenAI completion back. A Claude
// client calling /v1/messages with stream:false against kr/* saw exactly that.
describe("a non-streaming SSE body is translated from its real format (#3199)", () => {
  it("records the format the SSE parse actually produced", () => {
    const branch = src.slice(src.indexOf("const parsed = parseSSEToOpenAIResponse("));
    const upTo = branch.slice(0, branch.indexOf("} else {"));
    expect(upTo).toContain("effectiveTargetFormat = FORMATS.OPENAI");
  });

  it("translates from that format rather than from targetFormat", () => {
    expect(src).toContain("needsTranslation(effectiveTargetFormat, sourceFormat)");
    expect(src).toContain("translateNonStreamingResponse(responseBody, effectiveTargetFormat, sourceFormat");
    // The stale call must be gone, or the fix is only half applied.
    expect(src).not.toContain("translateNonStreamingResponse(responseBody, targetFormat, sourceFormat, customToolNames)\n    : responseBody");
  });

  it("defaults to targetFormat so every other path is unchanged", () => {
    expect(src).toContain("let effectiveTargetFormat = targetFormat;");
  });

  it("kiro is not forceStream, so it does reach this handler", async () => {
    const { PROVIDERS } = await import("../../open-sse/config/providers.js");
    expect(PROVIDERS.kiro.forceStream).not.toBe(true);
    expect(PROVIDERS.kiro.format).toBe("kiro");
  });

  it("the direct kiro to claude response route is registered", async () => {
    await import("../../open-sse/translator/index.js");
    // The response registry is module-private with no exported getter, so the
    // load-bearing assertion is that the module registering the route is
    // imported by the barrel.
    const barrel = readFileSync(new URL("../../open-sse/translator/index.js", import.meta.url), "utf8");
    expect(barrel).toContain("./response/kiro-to-claude.js");
  });
});
