import { describe, it, expect } from "vitest";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

// Passthrough providers (opencode free tier) echo the bare resolved model id,
// with the provider prefix stripped. Clients that trust the echo re-send it,
// so the echo must always be a name 9router can route again: the exact
// client-sent form for prefixed requests, the listing form (oc/big-pickle)
// for bare requests. Upstream sent the upstream id back unchanged.
const encoder = new TextEncoder();

const CHUNK =
  'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"big-pickle","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n';

async function pump(body, provider, model) {
  const stream = createPassthroughStreamWithLogger(
    provider,
    null,
    model,
    "conn-1",
    body,
    null,
  );

  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  let out = "";
  const drain = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
  })();

  await writer.write(encoder.encode(CHUNK));
  await writer.write(encoder.encode("data: [DONE]\n\n"));
  await writer.close();
  await drain;
  return out;
}

describe("stream model echo", () => {
  it("re-injects the listing prefix when the client sent a bare name", async () => {
    // Client sent the bare name; 9router resolves it to opencode and the echo
    // must come back as the listing form (oc/big-pickle) so clients that
    // validate the echoed model against /v1/models don't warn and fall back.
    const out = await pump(
      { model: "big-pickle", messages: [{ role: "user", content: "hi" }] },
      "opencode",
      "big-pickle",
    );
    expect(out).toContain('"model":"oc/big-pickle"');
    expect(out).not.toContain('"model":"big-pickle"');
    expect(out).toContain("data: [DONE]");
  });

  it("keeps the exact prefixed form the client sent", async () => {
    const out = await pump(
      { model: "oc/big-pickle", messages: [{ role: "user", content: "hi" }] },
      "opencode",
      "big-pickle",
    );
    expect(out).toContain('"model":"oc/big-pickle"');
    expect(out).not.toContain('"model":"big-pickle"');
  });

  it("leaves non-catalog providers untouched", async () => {
    const out = await pump(
      { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
      "openai",
      "gpt-4o",
    );
    expect(out).toContain('"model":"gpt-4o"');
  });
});
