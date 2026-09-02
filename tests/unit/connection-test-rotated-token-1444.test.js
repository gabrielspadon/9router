import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Issue #1444. A connection test that hits 401 refreshes the token. When the
// provider rotates the refresh token, the old one is spent upstream the moment
// the new one is issued. The handler then retried, and if that retry failed for
// any reason other than the token — a banned account, spent credits, an
// entitlement problem — it returned refreshed:false and dropped newTokens
// entirely. The rotated token was lost, the spent one was all that remained,
// and the connection could not be recovered without a full re-login. Running a
// connection test was what broke it.

const src = readFileSync(new URL("../../src/app/api/providers/[id]/test/testUtils.js", import.meta.url), "utf8");

describe("the OAuth probe is bounded (#1449)", () => {
  it("gives the initial probe and the post-refresh retry a timeout signal", () => {
    // A probe with no signal blocks the sequential test queue for as long as
    // the socket stays open, so one unreachable provider stalls every
    // connection behind it.
    for (const decl of ["const fetchOpts = { method: config.method, headers,",
                        "const retryOpts = { method: config.method, headers: retryHeaders,"]) {
      const at = src.indexOf(decl);
      expect(at, `missing options declaration: ${decl}`).toBeGreaterThan(-1);
      expect(src.slice(at, at + 220)).toContain("AbortSignal.timeout(FETCH_CONNECT_TIMEOUT_MS)");
    }
  });

  it("uses the constant the rest of the file already uses", () => {
    // Three other probes here were already bounded with it; the generic OAuth
    // probe was the outlier, so reuse beats inventing a second timeout.
    // Matched on the specifier rather than the whole import line: #1672 added
    // PROBE_MAX_TOKENS to the same statement, which is not a second timeout.
    expect(src).toMatch(/import \{[^}]*\bFETCH_CONNECT_TIMEOUT_MS\b[^}]*\} from "open-sse\/config\/runtimeConfig\.js"/);
    expect(src.split("AbortSignal.timeout(FETCH_CONNECT_TIMEOUT_MS)").length - 1).toBeGreaterThanOrEqual(5);
  });
});

describe("a connection test never strands a rotated token (#1444)", () => {
  // These assertions must discriminate against the pre-fix file. An earlier
  // version sliced from `if (retryClassified.valid)` to the old label and
  // asserted on `refreshed: true` / `newTokens: tokens` — but the SUCCESS
  // return sits inside that window and already carries both, so every one of
  // them passed without the fix. They are counted and anchored now.

  const occurrences = (needle) => src.split(needle).length - 1;

  it("carries the rotation on the failure path as well as the success path", () => {
    // Measured, not assumed: three of each at HEAD, four once the failure path
    // preserves the rotation. An earlier version of this test guessed two and
    // was wrong, which is how it ended up asserting nothing.
    expect(occurrences("newTokens: tokens")).toBe(4);
    expect(occurrences("refreshed: true")).toBe(4);
  });

  it("reports the retry's own error rather than blaming the renewed token", () => {
    const at = src.indexOf("retryClassified.error ||");
    expect(at, "failure path does not surface the retry's classification").toBeGreaterThan(-1);
    // It belongs to a valid:false return, not to the success return above it.
    const window = src.slice(Math.max(0, at - 220), at);
    expect(window).toContain("valid: false");
  });

  it("keeps the genuine no-refresh path reporting an invalid token", () => {
    // When the refresh itself fails there is no rotation to preserve and the
    // original label is correct, so that branch must survive untouched.
    expect(src).toContain('return { valid: false, error: "Token invalid or revoked", refreshed: false };');
  });

  it("persists a rotation regardless of whether the test passed", () => {
    // The fix only works because persistence keys on refreshed && newTokens
    // rather than on valid. If that gate ever narrows to valid, the rotated
    // token is dropped again and this test is the warning.
    const gate = src.slice(src.indexOf("if (result.refreshed && result.newTokens) {"));
    expect(gate.slice(0, 400)).toContain("updateData.refreshToken = result.newTokens.refreshToken");
  });
});
