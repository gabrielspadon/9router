import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getExecutor } from "open-sse/executors/index.js";

const codex = readFileSync(new URL("../../open-sse/executors/codex.js", import.meta.url), "utf8");

// executors/index.js holds ONE CodexExecutor for the whole process. The session
// id and the compact flag lived on that instance, so two concurrent requests
// overwrote each other between transformRequest and buildHeaders and a
// title-generation turn could be sent under the main turn's session_id (#3164).
describe("codex keeps per-request state off the shared executor (#3164)", () => {
  it("the executor really is a process-wide singleton", () => {
    // This is the premise. If it ever stops being true the fix is still correct,
    // but the failure it prevents would no longer be reachable.
    expect(getExecutor("codex")).toBe(getExecutor("codex"));
    expect(getExecutor("codex").constructor.name).toBe("CodexExecutor");
  });

  it("no instance fields carry request state any more", () => {
    expect(codex).not.toContain("this._currentSessionId");
    expect(codex).not.toContain("this._isCompact");
  });

  it("two concurrent requests keep their own session id", () => {
    const ex = getExecutor("codex");
    const a = { connectionId: "conn-a", rawHeaders: { "session_id": "sess-A" } };
    const b = { connectionId: "conn-b", rawHeaders: { "session_id": "sess-B" } };
    // Interleave exactly the way the singleton used to lose: resolve both, then
    // build both sets of headers.
    ex.transformRequest("gpt-5.6", { input: [] }, true, a);
    ex.transformRequest("gpt-5.6", { input: [] }, true, b);
    const ha = ex.buildHeaders(a, true);
    const hb = ex.buildHeaders(b, true);
    expect(ha["session_id"]).not.toBe(hb["session_id"]);
  });

  it("the compact flag is resolved before the URL is built", () => {
    // BaseExecutor calls buildUrl BEFORE transformRequest, so a flag set in
    // transformRequest was always one request late. execute() now stashes it.
    const stash = codex.indexOf("args.credentials._cxCompact = !!args.body?._compact;");
    expect(stash).toBeGreaterThan(0);
    expect(codex).toContain("return credentials?._cxCompact ? `${base}/compact` : base;");
  });

  it("compact routing follows the flag on the request's own credentials", () => {
    const ex = getExecutor("codex");
    const plain = { connectionId: "c1" };
    const compact = { connectionId: "c2", _cxCompact: true };
    expect(ex.buildUrl("gpt-5.6", true, 0, compact)).toMatch(/\/compact$/);
    expect(ex.buildUrl("gpt-5.6", true, 0, plain)).not.toMatch(/\/compact$/);
  });

  it("a request carrying neither field still gets a header and a plain URL", () => {
    // buildHeaders(null) throws inside the base class, which predates this
    // change; the reachable shape is an empty credentials object.
    const ex = getExecutor("codex");
    expect(ex.buildHeaders({}, true)["session_id"]).toBe("default");
    expect(ex.buildUrl("gpt-5.6", true, 0, null)).not.toMatch(/\/compact$/);
  });
});
