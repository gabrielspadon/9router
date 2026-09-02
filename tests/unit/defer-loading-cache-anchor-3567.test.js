import { describe, expect, it } from "vitest";
import { anchorClaudeCache, prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

// Anthropic refuses a tool that both defers loading and carries a cache anchor:
// "Tool '...' cannot both defer_loading=true cache_control set." MCP tools set
// defer_loading by default, so anchoring the LAST tool unconditionally 400'd the
// entire request whenever the last one happened to be an MCP tool.
const tool = (name, defer = false) => ({ name, input_schema: { type: "object", properties: {} }, ...(defer ? { defer_loading: true } : {}) });
const anchored = (tools) => {
  const body = { model: "m", messages: [{ role: "user", content: "hi" }], tools };
  anchorClaudeCache(body);
  return body.tools;
};
const withCache = (tools) => tools.filter((t) => t.cache_control);

describe("a deferred tool never carries a cache anchor (#3567)", () => {
  it("anchors the last NON-deferred tool when the last tool defers", () => {
    const out = anchored([tool("a"), tool("b"), tool("mcp__x", true)]);
    expect(out[2].cache_control).toBeUndefined();
    expect(out[1].cache_control).toBeTruthy();
  });

  it("anchors nothing when every tool defers", () => {
    const out = anchored([tool("mcp__a", true), tool("mcp__b", true)]);
    expect(withCache(out)).toHaveLength(0);
  });

  it("still anchors the last tool when none defer", () => {
    const out = anchored([tool("a"), tool("b")]);
    expect(out[1].cache_control).toBeTruthy();
    expect(out[0].cache_control).toBeUndefined();
  });

  it("anchors exactly one tool", () => {
    expect(withCache(anchored([tool("a"), tool("b"), tool("mcp__x", true)]))).toHaveLength(1);
    expect(withCache(anchored([tool("a"), tool("b")]))).toHaveLength(1);
  });

  it("skips a deferred tool in the middle without disturbing it", () => {
    const out = anchored([tool("a"), tool("mcp__mid", true), tool("c")]);
    expect(out[2].cache_control).toBeTruthy();
    expect(out[1].cache_control).toBeUndefined();
    expect(out[1].defer_loading).toBe(true);
  });

  it("the prepare path applies the same rule", () => {
    const body = { model: "m", messages: [{ role: "user", content: "hi" }], tools: [tool("a"), tool("mcp__x", true)] };
    const out = prepareClaudeRequest(body, "anthropic", "key");
    const t = out.tools || [];
    expect(t.find((x) => x.defer_loading)?.cache_control).toBeUndefined();
    expect(t.filter((x) => x.cache_control).length).toBeLessThanOrEqual(1);
  });
});
