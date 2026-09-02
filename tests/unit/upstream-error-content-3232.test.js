import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { detectUpstreamErrorContent } from "../../open-sse/services/upstreamErrorContent.js";

// Several upstreams answer HTTP 200 with their error inside the assistant
// content, so it reads downstream as the model's answer: no fallback fires and
// the error is written into the conversation history.
describe("an upstream error carried as 200 content is detected (#3232 #3242 #3468 #3636)", () => {
  it("catches the Codex overload blurb (#3232)", () => {
    const r = detectUpstreamErrorContent("Our servers are currently overloaded. Please try again later.");
    expect(r).toBeTruthy();
    expect(r.retryable).toBe(true);
  });

  it("catches the NaraRouter upstream-error lines (#3242)", () => {
    for (const t of [
      "Upstream error\nengine stream outcome=exhausted reason=invalid: model call unauthorized",
      "Upstream error\nengine stream outcome=invalid reason=invalid: byNara model call rejected request",
    ]) {
      expect(detectUpstreamErrorContent(t), t).toBeTruthy();
    }
  });

  it("catches the structured CommandCode marker and reads its own retry flag (#3468)", () => {
    const retryable = detectUpstreamErrorContent(
      '[CommandCode error: {"type":"server_error","message":"Service temporarily unavailable. Please try again shortly.","statusCode":503,"isRetryable":true}]');
    expect(retryable).toBeTruthy();
    expect(retryable.retryable).toBe(true);
    expect(retryable.status).toBe(503);

    const permanent = detectUpstreamErrorContent(
      '[CommandCode error: {"type":"server_error","message":"Messages with role \'tool\' must be a response to a preceding message with \'tool_calls\'","statusCode":400,"isRetryable":false}]');
    expect(permanent).toBeTruthy();
    expect(permanent.retryable).toBe(false);
    expect(permanent.status).toBe(400);
  });

  it("catches the truncated-stream marker (#3636)", () => {
    expect(detectUpstreamErrorContent(
      '[CommandCode error: {"type":"server_error","message":"Upstream stream ended before terminal chunk"}]')).toBeTruthy();
  });

  it("catches the qoder marker, whose status sits before the colon (#1996)", () => {
    // open-sse/executors/qoder.js turns a non-200 stream envelope into a
    // synthetic assistant chunk, so the error reads downstream as the model's
    // answer exactly as the CommandCode one did.
    const r = detectUpstreamErrorContent("\n[qoder error 429: rate limited]");
    expect(r).toBeTruthy();
    expect(r.status).toBe(429);
    expect(r.retryable).toBe(true);
    expect(detectUpstreamErrorContent("[qoder error 500: upstream status 500]").status).toBe(500);
  });

  it("does not treat ordinary prose containing 'error' as a marker", () => {
    expect(detectUpstreamErrorContent("The error 42: not a marker")).toBe(null);
    expect(detectUpstreamErrorContent("error: something went wrong")).toBe(null);
  });

  it("assumes retryable when the payload does not say", () => {
    const r = detectUpstreamErrorContent('[Acme error: {"type":"server_error"}]');
    expect(r.retryable).toBe(true);
    expect(r.status).toBe(null);
  });

  it("does not fire on a real answer that merely mentions a signature", () => {
    const essay = "When a service is overloaded it returns 503. " +
      "The phrase servers are currently overloaded is a standard blurb, and clients " +
      "should treat it as retryable rather than surfacing it to the user. ".repeat(4);
    expect(essay.length).toBeGreaterThan(300);
    expect(detectUpstreamErrorContent(essay)).toBe(null);
  });

  it("does not fire on ordinary short answers", () => {
    for (const t of ["42", "Yes.", "", "   ", "The capital of France is Paris."]) {
      expect(detectUpstreamErrorContent(t), t).toBe(null);
    }
  });

  it("does not fire on a non-string", () => {
    for (const v of [null, undefined, 7, {}, []]) expect(detectUpstreamErrorContent(v)).toBe(null);
  });

  it("is wired into the non-streaming handler ahead of the empty-content check", () => {
    const src = readFileSync(new URL("../../open-sse/handlers/chatCore/nonStreamingHandler.js", import.meta.url), "utf8");
    const detect = src.indexOf("detectUpstreamErrorContent(extractPanelText(");
    const empty = src.indexOf("if (!hasUsefulContent(");
    expect(detect).toBeGreaterThan(0);
    expect(empty).toBeGreaterThan(detect);
  });
});

describe("a streamed upstream error is caught before anything reaches the client (#3636)", () => {
  const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
  const respond = (frames) => new Response(
    new ReadableStream({
      start(c) {
        for (const f of frames) c.enqueue(new TextEncoder().encode(f));
        c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        c.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );

  const errorFrame = sse({
    choices: [{ index: 0, delta: { role: "assistant", content: '\n\n[CommandCode error: {"type":"server_error","message":"Service temporarily unavailable. Please try again shortly.","statusCode":503,"isRetryable":true}]' } }],
  });
  const realFrame = sse({ choices: [{ index: 0, delta: { role: "assistant", content: "Paris." } }] });

  it("reports no content so the caller falls over", async () => {
    const { peekStreamForContent } = await import("../../open-sse/utils/streamContent.js");
    const r = await peekStreamForContent(respond([errorFrame]), 2000, { preserveOnNoContent: true });
    expect(r.hasContent).toBe(false);
    expect(r.upstreamError).toBeTruthy();
    expect(r.upstreamError.status).toBe(503);
  });

  it("leaves a genuine first token alone", async () => {
    const { peekStreamForContent } = await import("../../open-sse/utils/streamContent.js");
    const r = await peekStreamForContent(respond([realFrame]), 2000, { preserveOnNoContent: true });
    expect(r.hasContent).toBe(true);
    expect(r.upstreamError).toBe(null);
  });

  it("extracts frame text across the shapes the error arrives in", async () => {
    const { frameContentText } = await import("../../open-sse/utils/streamContent.js");
    expect(frameContentText('data: {"choices":[{"delta":{"content":"hi"}}]}')).toBe("hi");
    expect(frameContentText('data: {"type":"content_block_delta","delta":{"text":"hi"}}')).toBe("hi");
    expect(frameContentText("data: [DONE]")).toBe("");
    expect(frameContentText("event: ping")).toBe("");
    expect(frameContentText("data: not json")).toBe("");
  });
});
