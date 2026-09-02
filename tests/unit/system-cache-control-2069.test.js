import { describe, expect, it } from "vitest";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";
import { filterToOpenAIFormat } from "../../open-sse/translator/formats/openai.js";

const SYS_CACHED = [
  { type: "text", text: "You are a helpful assistant." },
  { type: "text", text: "LONG PROJECT CONTEXT", cache_control: { type: "ephemeral" } },
];
const body = (system) => ({ model: "m", system, messages: [{ role: "user", content: "hi" }] });
const sysMsg = (out) => out.messages.find((m) => m.role === "system");

// A Claude system prompt is usually the largest cacheable chunk and its
// cache_control markers live on the individual blocks. Joining them into one
// string discarded the markers before the provider quirk that preserves them
// ever ran, so a DashScope/alicode account never saw a marker on the system
// prompt and cache hit rates stayed near zero.
describe("system-prompt cache_control survives to a preserving provider (#2069)", () => {
  it("keeps the block shape and the marker when one is present", () => {
    const out = claudeToOpenAIRequest("m", body(SYS_CACHED), false);
    const sys = sysMsg(out);
    expect(Array.isArray(sys.content)).toBe(true);
    expect(sys.content.some((b) => b.cache_control)).toBe(true);
  });

  it("preserves the marker through the filter for a preserving provider", () => {
    const out = claudeToOpenAIRequest("m", body(SYS_CACHED), false);
    const filtered = filterToOpenAIFormat(out, { preserveCacheControl: true });
    const sys = sysMsg(filtered);
    expect(Array.isArray(sys.content)).toBe(true);
    expect(sys.content.filter((b) => b.cache_control)).toHaveLength(1);
    expect(sys.content.find((b) => b.cache_control).text).toBe("LONG PROJECT CONTEXT");
  });

  it("collapses back to the original string for a non-preserving provider", () => {
    const out = claudeToOpenAIRequest("m", body(SYS_CACHED), false);
    const filtered = filterToOpenAIFormat(out, {});
    const sys = sysMsg(filtered);
    expect(typeof sys.content).toBe("string");
    expect(sys.content).toBe("You are a helpful assistant.\nLONG PROJECT CONTEXT");
  });

  it("is byte-identical to the old shape when no marker is present", () => {
    const plain = [{ type: "text", text: "a" }, { type: "text", text: "b" }];
    const sys = sysMsg(claudeToOpenAIRequest("m", body(plain), false));
    expect(sys.content).toBe("a\nb");
  });

  it("still handles a plain string system prompt", () => {
    const sys = sysMsg(claudeToOpenAIRequest("m", body("just a string"), false));
    expect(sys.content).toBe("just a string");
  });

  it("drops empty blocks rather than emitting empty text entries", () => {
    const withEmpty = [{ type: "text", text: "" }, { type: "text", text: "kept", cache_control: { type: "ephemeral" } }];
    const sys = sysMsg(claudeToOpenAIRequest("m", body(withEmpty), false));
    expect(sys.content).toHaveLength(1);
    expect(sys.content[0].text).toBe("kept");
  });
});
