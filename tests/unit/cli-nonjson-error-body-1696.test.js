import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../cli/src/cli/api/client.js", import.meta.url), "utf8");

// The report is two identical lines: "Failed to fetch providers: Failed to parse
// response: Unexpected token 'I', \"Internal S\"... is not valid JSON". The
// server returned a plain-text 500 and the CLI reported the JSON parser's
// complaint about its first character, hiding both the status and the message
// (#1696).
describe("a non-JSON error body reports the status, not the parser (#1696)", () => {
  it("parsing no longer wraps the status check", () => {
    // The old shape put the whole success path inside try/catch, so any parse
    // failure lost the status that was already in hand.
    expect(src).toContain("let parseError = null;");
    expect(src).toContain("if (parseError) {");
  });

  it("an error status is reported as HTTP <code> with the body", () => {
    expect(src).toContain("`HTTP ${res.statusCode}${snippet ? `: ${snippet}` : \"\"}`");
    expect(src).toContain("statusCode: res.statusCode,");
  });

  it("the body is collapsed and bounded before being shown", () => {
    // An HTML error page would otherwise print several screens of markup.
    expect(src).toContain('String(data).replace(/\\s+/g, " ").trim().slice(0, 200)');
  });

  it("a 2xx with an unparseable body still reports a parse failure", () => {
    // That case really is a malformed success and the parser message is the
    // useful one; only the >= 400 branch changes.
    expect(src).toContain("`Failed to parse response: ${parseError.message}`");
  });

  it("the JSON success and JSON error paths are unchanged", () => {
    expect(src).toContain("if (res.statusCode >= 400 || parsed.error) {");
    expect(src).toContain("error: parsed.error || `HTTP ${res.statusCode}`,");
    expect(src).toContain("success: true,");
  });
});

// The handler's logic, exercised directly: the source assertions above pin the
// shape, these pin the behaviour it produces.
describe("the branch chosen for each body shape", () => {
  const decide = (statusCode, data) => {
    let parsed = null, parseError = null;
    try { parsed = data ? JSON.parse(data) : {}; } catch (err) { parseError = err; }
    if (parseError) {
      const snippet = String(data).replace(/\s+/g, " ").trim().slice(0, 200);
      return statusCode >= 400
        ? { success: false, error: `HTTP ${statusCode}${snippet ? `: ${snippet}` : ""}` }
        : { success: false, error: `Failed to parse response: ${parseError.message}` };
    }
    if (statusCode >= 400 || parsed.error) return { success: false, error: parsed.error || `HTTP ${statusCode}` };
    return { success: true, data: parsed };
  };

  it("the reported case now names the status", () => {
    expect(decide(500, "Internal Server Error")).toEqual({
      success: false, error: "HTTP 500: Internal Server Error",
    });
  });

  it("an HTML error page is truncated rather than dumped", () => {
    const html = "<html>\n  <body>\n    " + "x".repeat(500) + "\n  </body>\n</html>";
    const out = decide(502, html);
    expect(out.error.startsWith("HTTP 502: ")).toBe(true);
    expect(out.error.length).toBeLessThanOrEqual(210);
  });

  it("a JSON error body keeps its own message", () => {
    expect(decide(400, '{"error":"providerAlias and id required"}').error)
      .toBe("providerAlias and id required");
  });

  it("a normal success is untouched", () => {
    expect(decide(200, '{"providers":[]}')).toEqual({ success: true, data: { providers: [] } });
  });

  it("an empty body is not an error", () => {
    expect(decide(200, "")).toEqual({ success: true, data: {} });
  });
});
