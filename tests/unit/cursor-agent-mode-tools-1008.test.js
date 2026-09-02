import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../open-sse/executors/cursor.js", import.meta.url), "utf8");
const fn = src.slice(src.indexOf("transformRequest(model, body, stream, credentials)"));
const body = fn.slice(0, fn.indexOf("generateCursorBody"));

// Cursor answers "Switch to Agent mode to apply all changes" and the flow stops
// unless agent mode is forced. The trigger was a Claude Code user-agent
// allowlist, so every other agentic client hit the same wall and needed its own
// UA added — opencode reported exactly that.
describe("Cursor agent mode triggers on the request, not the client name (#1008)", () => {
  it("still honours the Claude Code user agents", () => {
    for (const ua of ["claude-cli", "claude-code", "Claude Code"]) {
      expect(body, ua).toContain(`ua.includes("${ua}")`);
    }
  });

  it("also triggers when the request carries tools", () => {
    expect(body).toContain("agenticUA || tools.length > 0");
  });

  it("can only widen, never narrow", () => {
    // An AND here would stop every client that worked on the UA alone.
    const line = body.split("\n").find((l) => l.includes("const forceAgentMode"));
    expect(line).toContain("||");
    expect(line).not.toContain("&&");
  });

  it("reads tools from the body it is about to send", () => {
    expect(body).toContain("const tools = body.tools || []");
  });

  it("reproduces the trigger's contract", () => {
    const force = (ua, tools) =>
      ua.includes("claude-cli") || ua.includes("claude-code") || ua.includes("Claude Code") || tools.length > 0;
    expect(force("opencode/1.2", [{ name: "edit" }])).toBe(true);   // the report
    expect(force("claude-cli/1.0", [])).toBe(true);                 // old behaviour kept
    expect(force("opencode/1.2", [])).toBe(false);                  // plain chat unchanged
    expect(force("", [])).toBe(false);
  });
});
