import { describe, expect, it } from "vitest";
import { readResponseJsonWithDeadline } from "open-sse/utils/bodyTimeout.js";

// An upstream that answers with an HTML error page, a proxy's plain-text
// refusal, or an empty body made this throw "Unexpected token < in JSON at
// position 0". That SyntaxError names the parser and never the upstream, so a
// gateway timeout and a provider outage looked identical, and neither looked
// like what it actually was (#1930, and the same shape as #3441).
const bodyOf = (text) => ({
  body: new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); },
  }),
});

describe("a non-JSON upstream body names itself (#1930)", () => {
  it("carries the body instead of a parser error", async () => {
    const html = "<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>";
    await expect(readResponseJsonWithDeadline(bodyOf(html)))
      .rejects.toThrow(/Upstream returned a non-JSON body.*502 Bad Gateway/s);
  });

  it("says so plainly when the body is empty", async () => {
    await expect(readResponseJsonWithDeadline(bodyOf("")))
      .rejects.toThrow(/empty body where JSON was expected/);
  });

  it("treats a whitespace-only body as empty rather than quoting nothing", async () => {
    await expect(readResponseJsonWithDeadline(bodyOf("   \n\t ")))
      .rejects.toThrow(/empty body where JSON was expected/);
  });

  it("keeps the original parse error and the full text for a caller that wants them", async () => {
    const text = "not json at all";
    try {
      await readResponseJsonWithDeadline(bodyOf(text));
      throw new Error("should have rejected");
    } catch (error) {
      expect(error.cause).toBeInstanceOf(SyntaxError);
      expect(error.responseText).toBe(text);
    }
  });

  it("truncates a large page rather than putting kilobytes in a message", async () => {
    // An HTML error page can be tens of kilobytes; the first line identifies
    // who produced it and the rest is noise in a log.
    const huge = "<html>" + "x".repeat(50_000) + "</html>";
    try {
      await readResponseJsonWithDeadline(bodyOf(huge));
      throw new Error("should have rejected");
    } catch (error) {
      expect(error.message.length).toBeLessThan(400);
      expect(error.responseText.length).toBe(huge.length);
    }
  });

  it("still returns parsed JSON when the body is JSON", async () => {
    await expect(readResponseJsonWithDeadline(bodyOf('{"ok":true,"n":2}')))
      .resolves.toEqual({ ok: true, n: 2 });
  });
});
