/**
 * Unit tests for client-provided cache_control preservation in
 * open-sse/translator/formats/claude.js (prepareClaudeRequest + anchorClaudeCache).
 *
 * A complete client breakpoint plan within Anthropic's 4-breakpoint limit
 * survives verbatim; anything absent, over the limit, or malformed falls back
 * to the legacy strip-and-re-anchor policy (system tail 1h, tool tail 1h,
 * last assistant 5m).
 */

import { describe, it, expect } from "vitest";
import {
  prepareClaudeRequest,
  anchorClaudeCache,
} from "../../open-sse/translator/formats/claude.js";

const ANCHOR_1H = { type: "ephemeral", ttl: "1h" };
const ANCHOR_5M = { type: "ephemeral" };

function fullPipeline(body) {
  return anchorClaudeCache(prepareClaudeRequest(body, "anthropic", "key"));
}

function anchoredBlocks(body) {
  const out = [];
  const visit = (block, where) => {
    if (block && typeof block === "object" && block.cache_control != null) {
      out.push({ where, block, cc: block.cache_control });
    }
  };
  (body.system || []).forEach(b => visit(b, "system"));
  (body.tools || []).forEach(t => visit(t, "tool"));
  (body.messages || []).forEach((m, mi) => (m.content || []).forEach(b => visit(b, `msg${mi}`)));
  return out;
}

function validPlanBody() {
  return {
    system: [{ type: "text", text: "system prompt", cache_control: { ...ANCHOR_1H } }],
    tools: [
      { name: "tool_a", description: "a", input_schema: { type: "object" }, cache_control: { ...ANCHOR_5M } },
    ],
    messages: [
      { role: "user", content: [{ type: "text", text: "hello", cache_control: { ...ANCHOR_5M } }] },
      { role: "assistant", content: [{ type: "text", text: "hi there", cache_control: { ...ANCHOR_1H } }] },
    ],
  };
}

describe("client cache_control preservation", () => {
  it("keeps a valid 4-breakpoint client plan verbatim through the full pipeline", () => {
    const out = fullPipeline(validPlanBody());
    const anchors = anchoredBlocks(out);
    expect(anchors).toHaveLength(4);
    expect(out.system[0].cache_control).toEqual(ANCHOR_1H);
    expect(out.tools[0].cache_control).toEqual(ANCHOR_5M);
    expect(out.messages[0].content[0].cache_control).toEqual(ANCHOR_5M);
    expect(out.messages[1].content[0].cache_control).toEqual(ANCHOR_1H);
  });

  it("keeps a valid 2-breakpoint mixed-ttl plan verbatim", () => {
    const body = {
      system: [{ type: "text", text: "sys" }],
      messages: [
        { role: "user", content: [{ type: "text", text: "q" }] },
        { role: "assistant", content: [{ type: "text", text: "a", cache_control: { ...ANCHOR_1H } }] },
      ],
    };
    const out = fullPipeline(body);
    const anchors = anchoredBlocks(out);
    expect(anchors).toHaveLength(2);
    // client's 1h on the assistant block survives
    expect(out.messages[1].content[0].cache_control).toEqual(ANCHOR_1H);
    // fallback 1h backfilled on the unanchored system tail (client left it bare)
    expect(out.system[0].cache_control).toEqual(ANCHOR_1H);
    // no ephemeral anchor stacked onto the already-anchored assistant turn
    expect(out.messages[1].content[0].cache_control).not.toEqual(ANCHOR_5M);
  });

  it("backfills the tool-tail 1h anchor when the client anchored only messages", () => {
    const body = {
      tools: [{ name: "t", description: "d", input_schema: { type: "object" } }],
      messages: [
        { role: "user", content: [{ type: "text", text: "q", cache_control: { ...ANCHOR_5M } }] },
      ],
    };
    const out = fullPipeline(body);
    expect(out.tools[0].cache_control).toEqual(ANCHOR_1H);
    expect(out.messages[0].content[0].cache_control).toEqual(ANCHOR_5M);
  });

  it("falls back to legacy anchors when the client sends more than 4 breakpoints", () => {
    const body = {
      system: [{ type: "text", text: "sys", cache_control: { ...ANCHOR_1H } }],
      tools: [
        { name: "t1", description: "d", input_schema: { type: "object" }, cache_control: { ...ANCHOR_1H } },
        { name: "t2", description: "d", input_schema: { type: "object" } },
      ],
      messages: [
        { role: "user", content: [{ type: "text", text: "q1", cache_control: { ...ANCHOR_5M } }] },
        { role: "assistant", content: [{ type: "text", text: "a1", cache_control: { ...ANCHOR_5M } }] },
        { role: "user", content: [{ type: "text", text: "q2", cache_control: { ...ANCHOR_5M } }] },
        { role: "assistant", content: [{ type: "text", text: "a2", cache_control: { ...ANCHOR_5M } }] },
      ],
    };
    const out = fullPipeline(body);
    // exactly 3 anchors: system tail 1h, last cacheable tool 1h, last assistant ephemeral
    const anchors = anchoredBlocks(out);
    expect(anchors).toHaveLength(3);
    expect(out.system[0].cache_control).toEqual(ANCHOR_1H);
    expect(out.tools[0].cache_control).toBeUndefined();
    expect(out.tools[1].cache_control).toEqual(ANCHOR_1H);
    expect(out.messages[0].content[0].cache_control).toBeUndefined();
    expect(out.messages[1].content[0].cache_control).toBeUndefined();
    expect(out.messages[2].content[0].cache_control).toBeUndefined();
    expect(out.messages[3].content[0].cache_control).toEqual(ANCHOR_5M);
  });

  it("falls back to legacy anchors when a client ttl is malformed", () => {
    const body = {
      system: [{ type: "text", text: "sys" }],
      messages: [
        { role: "user", content: [{ type: "text", text: "q", cache_control: { type: "ephemeral", ttl: "30m" } }] },
        { role: "assistant", content: [{ type: "text", text: "a" }] },
      ],
    };
    const out = fullPipeline(body);
    expect(out.system[0].cache_control).toEqual(ANCHOR_1H);
    expect(out.messages[0].content[0].cache_control).toBeUndefined();
    expect(out.messages[1].content[0].cache_control).toEqual(ANCHOR_5M);
  });

  it("falls back to legacy anchors when a client cache_control type is wrong", () => {
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "q", cache_control: { type: "persistent" } }] },
        { role: "assistant", content: [{ type: "text", text: "a" }] },
      ],
    };
    const out = fullPipeline(body);
    expect(out.messages[0].content[0].cache_control).toBeUndefined();
    expect(out.messages[1].content[0].cache_control).toEqual(ANCHOR_5M);
  });

  it("applies unchanged legacy anchors when the client sends none", () => {
    const body = {
      system: [{ type: "text", text: "sys" }],
      tools: [{ name: "t", description: "d", input_schema: { type: "object" } }],
      messages: [
        { role: "user", content: [{ type: "text", text: "q" }] },
        { role: "assistant", content: [{ type: "text", text: "a" }] },
      ],
    };
    const out = fullPipeline(body);
    expect(out.system[0].cache_control).toEqual(ANCHOR_1H);
    expect(out.tools[0].cache_control).toEqual(ANCHOR_1H);
    expect(out.messages[0].content[0].cache_control).toBeUndefined();
    expect(out.messages[1].content[0].cache_control).toEqual(ANCHOR_5M);
  });

  it("keeps empty-system-block filtering working alongside a preserved plan (#2047)", () => {
    const body = {
      system: [
        { type: "text", text: "" },
        { type: "text", text: "real system", cache_control: { ...ANCHOR_1H } },
      ],
      messages: [{ role: "user", content: [{ type: "text", text: "q" }] }],
    };
    const out = prepareClaudeRequest(body, "anthropic", "key");
    expect(out.system).toHaveLength(1);
    expect(out.system[0].text).toBe("real system");
    expect(out.system[0].cache_control).toEqual(ANCHOR_1H);
  });

  it("prepareClaudeRequest alone preserves a valid plan (no anchorClaudeCache pass)", () => {
    const out = prepareClaudeRequest(validPlanBody(), "anthropic", "key");
    expect(out.system[0].cache_control).toEqual(ANCHOR_1H);
    expect(out.tools[0].cache_control).toEqual(ANCHOR_5M);
    expect(out.messages[1].content[0].cache_control).toEqual(ANCHOR_1H);
    expect(anchoredBlocks(out)).toHaveLength(4);
  });

  it("anchorClaudeCache alone preserves a valid plan", () => {
    const out = anchorClaudeCache(validPlanBody());
    expect(anchoredBlocks(out)).toHaveLength(4);
    expect(out.system[0].cache_control).toEqual(ANCHOR_1H);
    expect(out.tools[0].cache_control).toEqual(ANCHOR_5M);
    expect(out.messages[1].content[0].cache_control).toEqual(ANCHOR_1H);
  });

  it("abandons the preserve when backfilling would exceed the 4-breakpoint ceiling", () => {
    // 4 client anchors (tool, q1, q2, a2), none on the system tail: backfilling
    // the system fallback would emit 5, so the whole plan is dropped.
    const body = {
      system: [{ type: "text", text: "sys" }],
      tools: [{ name: "t", description: "d", input_schema: { type: "object" }, cache_control: { ...ANCHOR_1H } }],
      messages: [
        { role: "user", content: [
          { type: "text", text: "q1", cache_control: { ...ANCHOR_5M } },
        ] },
        { role: "user", content: [
          { type: "text", text: "q2", cache_control: { ...ANCHOR_5M } },
        ] },
        { role: "assistant", content: [
          { type: "text", text: "a1" },
          { type: "text", text: "a2", cache_control: { ...ANCHOR_5M } },
        ] },
      ],
    };
    const out = anchorClaudeCache(body);
    const anchors = anchoredBlocks(out);
    // legacy: system tail 1h, tool tail 1h, last assistant block ephemeral
    expect(anchors).toHaveLength(3);
    expect(out.system[0].cache_control).toEqual(ANCHOR_1H);
    expect(out.tools[0].cache_control).toEqual(ANCHOR_1H);
    expect(out.messages[2].content[0].cache_control).toBeUndefined();
    expect(out.messages[2].content[1].cache_control).toEqual(ANCHOR_5M);
  });
});
