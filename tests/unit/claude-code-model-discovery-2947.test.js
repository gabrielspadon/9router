import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detectClientTool } from "open-sse/utils/clientDetector.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const route = readFileSync(join(root, "src/app/api/v1/models/route.js"), "utf8");

describe("Claude Code model discovery (#2947)", () => {
  it("the client is recognised from its user agent alone", () => {
    // The documented discovery request sends credential headers and nothing
    // else, so anthropic-version is absent from it.
    expect(detectClientTool({ "user-agent": "claude-cli/2.1.0 (external, cli)" }, {})).toBe("claude");
    expect(detectClientTool({ "user-agent": "claude-code/1.0" }, {})).toBe("claude");
  });

  it("the rewrite gate accepts the detector, not only the version header", () => {
    expect(route).toContain('request?.headers?.get("anthropic-version") || clientTool === "claude"');
  });

  it("the detector runs before the gate that now depends on it", () => {
    const detect = route.indexOf("const clientTool = detectClientTool(headers, {})");
    const gate = route.indexOf('clientTool === "claude"');
    expect(detect).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(detect);
  });

  it("is detected once and reused for the Codex catalog branch", () => {
    expect(route).toContain('if (clientTool === "codex") {');
    expect(route).not.toContain('if (detectClientTool(headers, {}) === "codex") {');
  });

  it("still honours the kill switch", () => {
    expect(route).toContain('process.env.DISABLE_CLAUDE_COMPAT !== "true"');
  });

  it("leaves an OpenAI client's list untouched", () => {
    expect(detectClientTool({ "user-agent": "OpenAI/NodeJS/4.0" }, {})).not.toBe("claude");
  });
});

// Reproduces the exact gate expression from the route (the boolean above the
// `it("the rewrite gate accepts the detector..."` assertion) against a bare
// header getter, so the identity-vs-protocol claim can be checked without
// standing up the full GET handler's provider/db dependencies.
function rewriteGate(headerValue, clientTool) {
  const request = { headers: { get: (name) => (name === "anthropic-version" ? headerValue : null) } };
  return Boolean(request.headers.get("anthropic-version") || clientTool === "claude");
}

describe("the rewrite is protocol-keyed first, identity only as the one-call fallback (#2947)", () => {
  it("any client sending anthropic-version gets it, not only claude-cli", () => {
    // A hypothetical harness built on @anthropic-ai/sdk that isn't Claude Code
    // at all still sends this header on every real request and gets the
    // identical treatment — the header decides, not the tool name.
    expect(rewriteGate("2023-06-01", detectClientTool({ "user-agent": "SomeOtherAnthropicHarness/1.0" }, {}))).toBe(true);
    expect(rewriteGate("2023-06-01", null)).toBe(true);
  });

  it("the identity fallback only ever fires when the header is absent", () => {
    expect(rewriteGate(null, "claude")).toBe(true);
    expect(rewriteGate(null, "codex")).toBe(false);
    expect(rewriteGate(null, null)).toBe(false);
  });

  it("once the header is present, clientTool cannot change the outcome", () => {
    for (const tool of ["claude", "codex", "gemini-cli", null]) {
      expect(rewriteGate("2023-06-01", tool)).toBe(true);
    }
  });
});
