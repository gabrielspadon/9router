import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { detectUpstreamErrorContent } from "open-sse/services/upstreamErrorContent.js";
import { peekStreamForContent } from "open-sse/utils/streamContent.js";

const combo = readFileSync(new URL("../../open-sse/services/combo.js", import.meta.url), "utf8");

const sse = (chunks) =>
  new Response(
    new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\n\n`));
        c.enqueue(enc.encode("data: [DONE]\n\n"));
        c.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  );

const frame = (content) => ({
  id: "x", object: "chat.completion.chunk", created: 0, model: "m",
  choices: [{ index: 0, delta: { content }, finish_reason: "stop" }],
});

// qoder answers HTTP 200 and puts a non-200 upstream status INTO the assistant
// content as `[qoder error 429: …]`. Fallback did fire — the peek refuses to
// count that as content — but every member reported "provider returned an empty
// stream", so an exhausted combo answered 503 with no trace of the rate limit
// (#1996).
describe("a combo member's in-content upstream error keeps its reason (#1996)", () => {
  it("the peek reports the error instead of counting it as content", async () => {
    const peek = await peekStreamForContent(sse([frame("\n[qoder error 429: rate limited]")]));
    expect(peek.hasContent).toBe(false);
    expect(peek.upstreamError).not.toBeNull();
    expect(peek.upstreamError.status).toBe(429);
  });

  it("a real answer is untouched", async () => {
    const peek = await peekStreamForContent(sse([frame("Hello there")]));
    expect(peek.hasContent).toBe(true);
    expect(peek.upstreamError).toBeNull();
  });

  it("combo destructures upstreamError and reports it before the empty-stream case", () => {
    expect(combo).toContain("body: replayBody, upstreamError } = await peekStreamForContent(result)");
    const guard = combo.indexOf("if (upstreamError) {");
    const empty = combo.indexOf('lastError = "provider returned an empty stream"');
    expect(guard).toBeGreaterThan(0);
    // Order matters: the empty-stream branch is the fallthrough, so an error
    // reaching it first would erase the reason again.
    expect(guard).toBeLessThan(empty);
    expect(combo).toContain("lastStatus = upstreamError.status || 502");
  });

  it("the status carried out is the upstream's, not a blanket 503", () => {
    expect(detectUpstreamErrorContent("[qoder error 429: rate limited]").status).toBe(429);
    // No status in the marker is the shape that must still fall back, just
    // without inventing one.
    expect(detectUpstreamErrorContent("[qoder error: boom]").status).toBeNull();
  });
});
