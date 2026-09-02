import { describe, expect, it } from "vitest";
import { forwardClientHeaders } from "open-sse/utils/clientHeaderPassthrough.js";
import { readFileSync } from "node:fs";

// An agent that sets X-Title, HTTP-Referer or X-Session-ID expects them to reach
// the provider: that is how several providers attribute usage and how the agent
// correlates its own traces. TokenProxy dropped all of them (#2413).
const ours = () => ({ "Content-Type": "application/json", Authorization: "Bearer sk-real" });

describe("a client's custom headers reach the upstream (#2413)", () => {
  it("forwards x- prefixed headers", () => {
    const h = forwardClientHeaders(ours(), { "X-Session-ID": "s1", "X-Title": "my agent" });
    expect(h["X-Session-ID"]).toBe("s1");
    expect(h["X-Title"]).toBe("my agent");
  });

  it("forwards the two attribution headers providers actually read", () => {
    const h = forwardClientHeaders(ours(), { "User-Agent": "my-agent/1.0", "HTTP-Referer": "https://x" });
    expect(h["User-Agent"]).toBe("my-agent/1.0");
    expect(h["HTTP-Referer"]).toBe("https://x");
  });

  it("preserves the client's own casing", () => {
    const h = forwardClientHeaders(ours(), { "x-session-id": "s1" });
    expect(h["x-session-id"]).toBe("s1");
  });
});

describe("what it refuses to forward", () => {
  it("never the caller's credential", () => {
    const h = forwardClientHeaders(ours(), {
      authorization: "Bearer sk-caller", "x-api-key": "caller-key", "api-key": "k",
    });
    expect(h.Authorization).toBe("Bearer sk-real");
    expect(h["x-api-key"]).toBeUndefined();
    expect(h["api-key"]).toBeUndefined();
  });

  it("never framing or hop-by-hop headers", () => {
    const h = forwardClientHeaders(ours(), {
      host: "evil", "content-length": "9", "transfer-encoding": "chunked",
      "accept-encoding": "gzip", connection: "close",
    });
    for (const k of ["host", "content-length", "transfer-encoding", "accept-encoding", "connection"])
      expect(h[k]).toBeUndefined();
  });

  it("never the caller's cookies, which are its session with us", () => {
    expect(forwardClientHeaders(ours(), { cookie: "session=abc" }).cookie).toBeUndefined();
  });

  it("never this router's internal stamps", () => {
    const h = forwardClientHeaders(ours(), {
      "x-tp-peer-token": "t", "x-tp-real-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8",
    });
    for (const k of ["x-tp-peer-token", "x-tp-real-ip", "x-forwarded-for"])
      expect(h[k]).toBeUndefined();
  });

  it("never the headers with deliberate handling elsewhere", () => {
    const h = forwardClientHeaders(ours(), {
      "anthropic-beta": "caller-flag", "anthropic-version": "1999-01-01", "x-app": "cli",
    });
    for (const k of ["anthropic-beta", "anthropic-version", "x-app"]) expect(h[k]).toBeUndefined();
  });

  it("never a header this router already set, whatever the casing", () => {
    // Cloaking that chose a User-Agent must not be undone by the client's.
    const h = forwardClientHeaders({ "User-Agent": "claude-cli/2.1.92" }, { "user-agent": "curl/8" });
    expect(h["User-Agent"]).toBe("claude-cli/2.1.92");
    expect(h["user-agent"]).toBeUndefined();
  });

  it("nothing outside the x- prefix and those two names", () => {
    const h = forwardClientHeaders(ours(), { accept: "text/html", "if-none-match": "W/1" });
    expect(h.accept).toBeUndefined();
    expect(h["if-none-match"]).toBeUndefined();
  });

  it("no headers at all is a no-op", () => {
    const h = ours();
    expect(forwardClientHeaders(h, null)).toBe(h);
    expect(forwardClientHeaders(h, undefined)).toBe(h);
  });

  it("skips a non-string or empty value rather than sending it", () => {
    const h = forwardClientHeaders(ours(), { "x-a": "", "x-b": 5, "x-c": null, "x-d": "ok" });
    expect(h["x-a"]).toBeUndefined();
    expect(h["x-b"]).toBeUndefined();
    expect(h["x-c"]).toBeUndefined();
    expect(h["x-d"]).toBe("ok");
  });
});

describe("the default executor applies it last", () => {
  const src = readFileSync(new URL("../../open-sse/executors/default.js", import.meta.url), "utf8");
  it("after every header it builds itself", () => {
    const i = src.indexOf("forwardClientHeaders(headers, credentials?.rawHeaders)");
    expect(i).toBeGreaterThan(src.indexOf("applyAuth(headers, desc, credentials)"));
    expect(i).toBeLessThan(src.indexOf("return headers;", i - 200) + 200);
  });
});
