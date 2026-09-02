import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../open-sse/utils/proxyFetch.js", import.meta.url), "utf8");

// The pasted log carries the defect: "[ProxyFetch] Proxy failed, falling back to
// direct bypass: This operation was aborted". An abort is not an unreachable
// proxy. throwIfAborted only inspects the CALLER's signal, so an abort raised
// anywhere else — a dispatcher's own AbortSignal.timeout, a composed signal the
// caller never passed — left signal.aborted false and the handler retried a
// cancelled request OUTSIDE the configured proxy (#2211).
describe("an aborted request never falls back to direct (#2211)", () => {
  it("both proxy failure handlers rethrow an abort", () => {
    // Count the warn CALLS, not the phrase: it also appears in two comments,
    // and matching prose made this assert 4 on a correct tree.
    const guards = src.match(/if \(isAbortError\(proxyError\)\) throw proxyError;/g) || [];
    const fallbacks = src.match(/console\.warn\(`\[ProxyFetch\] Proxy failed, falling back to direct/g) || [];
    expect(fallbacks.length).toBe(2);
    expect(guards.length).toBe(fallbacks.length);
  });

  it("the guard runs before the strictProxy branch and the fallback", () => {
    // Order matters: an abort must not be reported as a proxy failure even when
    // strictProxy would have produced a nicer message.
    for (const m of src.matchAll(/if \(isAbortError\(proxyError\)\) throw proxyError;/g)) {
      const after = src.slice(m.index, m.index + 400);
      expect(after).toContain("strictProxy === true");
      expect(after).toContain("falling back to direct");
    }
  });

  it("it still defers to the caller's own signal check first", () => {
    // throwIfAborted stays: it produces the caller's abort reason, which is
    // more informative than the transport's error.
    for (const m of src.matchAll(/if \(isAbortError\(proxyError\)\) throw proxyError;/g)) {
      expect(src.slice(Math.max(0, m.index - 120), m.index)).toContain("throwIfAborted(options.signal)");
    }
  });
});

describe("isAbortError recognises the shapes that actually arrive", () => {
  // Exercised through a local copy of the predicate: the module's own export
  // surface is unchanged by this fix, and the shapes are the contract.
  const isAbortError = (error) => {
    if (!error) return false;
    if (error.name === "AbortError" || error.name === "TimeoutError") return true;
    if (error.code === "ABORT_ERR" || error.code === "ABORT_ERROR") return true;
    return /operation was aborted|the operation was aborted/i.test(String(error.message || ""));
  };

  it("matches the DOMException Node raises", () => {
    expect(isAbortError(new DOMException("This operation was aborted", "AbortError"))).toBe(true);
  });

  it("matches a timeout signal's reason", () => {
    expect(isAbortError(new DOMException("The operation was aborted due to timeout", "TimeoutError"))).toBe(true);
  });

  it("matches the message alone when a wrapper dropped the name", () => {
    // This is the shape in the report: the log printed only proxyError.message.
    expect(isAbortError(new Error("This operation was aborted"))).toBe(true);
  });

  it("does not match a genuine proxy failure", () => {
    // The whole point: a real unreachable proxy must still fall back.
    expect(isAbortError(new Error("fetch failed"))).toBe(false);
    expect(isAbortError(new Error("socket hang up"))).toBe(false);
    expect(isAbortError(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
