import { describe, expect, it } from "vitest";
import { selectAnthropicBeta } from "../../open-sse/providers/shared.js";

// #2582: Claude Code's Advisor server tool ("/advisor <model>") requires the
// "advisor-tool-2026-03-01" beta flag on the official Anthropic route, or the
// client reports "No such tool available: advisor". The claude/claude-format
// request already passes through untouched for a same-format route
// (translator/index.js skips translation entirely when sourceFormat ===
// targetFormat), so the tool definition itself was never being stripped —
// the gap was this default beta flag list executors/default.js builds the
// outgoing Anthropic-Beta header from for the official "claude"/"anthropic"
// providers (buildHeaders() unions it with any client-supplied beta flags,
// but a client that omits its own header still needs the default to carry it).
describe("Anthropic Advisor beta flag (#2582)", () => {
  it("includes the advisor-tool beta flag for a Claude Code main model", () => {
    expect(selectAnthropicBeta("claude-sonnet-5").split(",")).toContain("advisor-tool-2026-03-01");
  });

  it("includes it unconditionally, not gated to opus/sonnet like the heavy-agent flags", () => {
    expect(selectAnthropicBeta("claude-haiku-4-5-20251001").split(",")).toContain("advisor-tool-2026-03-01");
  });
});
