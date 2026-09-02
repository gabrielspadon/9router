import { describe, it, expect } from "vitest";
import { __test__ as qoderInternals } from "../../open-sse/executors/qoder.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

// #2813 — a Qoder alias key (qd/qmodel_preview, qd/auto) is answered upstream
// with the alias echoed back as the chunk's `model`, so a transcript never
// records which model actually ran. The live catalogue knows the resolved name
// (`model_config.display_name`), and it is now carried on every chunk.
//
// It rides ALONGSIDE `model` rather than replacing it: the echoed model id is
// what clients re-send on the next hop, so replacing it with a name tokenproxy
// cannot route would break the round trip. That is the report's own second
// option ("include both").

const { wrapQoderSSE, annotateResolvedModel } = qoderInternals;

function makeResponse(lines) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

async function drain(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

function envelope(inner, statusCodeValue = 200) {
  return `data: ${JSON.stringify({ statusCodeValue, body: inner })}\n\n`;
}

function dataFrames(out) {
  return out
    .split("\n\n")
    .filter((f) => f.startsWith("data: ") && !f.includes("[DONE]"))
    .map((f) => JSON.parse(f.slice("data: ".length)));
}

describe("qoder resolved model name (#2813)", () => {
  it("carries the resolved catalogue name on every chunk", async () => {
    const chunks = [
      '{"id":"c","object":"chat.completion.chunk","model":"auto","choices":[{"index":0,"delta":{"role":"assistant"}}]}',
      '{"id":"c","object":"chat.completion.chunk","model":"auto","choices":[{"index":0,"delta":{"content":"hi"}}]}',
    ];
    const wrapped = await wrapQoderSSE(
      makeResponse(chunks.map((c) => envelope(c))),
      "qoder/qmodel_preview",
      "Qwen3.8-Max-Preview",
    );
    const frames = dataFrames(await drain(wrapped));

    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(frame.x_resolved_model).toBe("Qwen3.8-Max-Preview");
      // The routable id is untouched — clients echo it back to route the next hop.
      expect(frame.model).toBe("auto");
    }
  });

  it("leaves the stream byte-identical when the catalogue has no display name", async () => {
    const inner = '{"id":"c","model":"auto","choices":[{"index":0,"delta":{"content":"hi"}}]}';
    const before = await drain(await wrapQoderSSE(makeResponse([envelope(inner)]), "qoder/auto"));
    expect(before).toContain(`data: ${inner}\n\n`);
    expect(before).not.toContain("x_resolved_model");
  });

  it("passes a non-JSON inner body through untouched rather than dropping it", () => {
    // Fail-open: an unparseable frame is forwarded exactly as received.
    expect(annotateResolvedModel("not json", "Qwen3.8-Max-Preview")).toBe("not json");
    expect(annotateResolvedModel("[1,2]", "Qwen3.8-Max-Preview")).toBe("[1,2]");
  });

  it("reaches the client through the passthrough stream qoder actually runs in", async () => {
    // qoder speaks OpenAI to an OpenAI client, so there is no translation hop:
    // the executor's frames go through createPassthroughStreamWithLogger, which
    // rewrites `model` to the canonical echo form. The resolved name has to
    // survive that rewrite, which is the reason it is a separate field.
    const inner = '{"id":"c","object":"chat.completion.chunk","created":1,"model":"auto","choices":[{"index":0,"delta":{"content":"hi"}}]}';
    const wrapped = await wrapQoderSSE(
      makeResponse([envelope(inner)]),
      "qoder/qmodel_preview",
      "Qwen3.8-Max-Preview",
    );

    const through = createPassthroughStreamWithLogger(
      "qoder", null, "qmodel_preview", "conn-1",
      { model: "qd/qmodel_preview", messages: [{ role: "user", content: "hi" }] },
    );
    const writer = through.writable.getWriter();
    const reader = through.readable.getReader();
    let out = "";
    const collect = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out += new TextDecoder().decode(value);
      }
    })();
    writer.write(new TextEncoder().encode(await drain(wrapped)));
    await writer.close();
    await collect;

    const frame = dataFrames(out)[0];
    expect(frame.x_resolved_model).toBe("Qwen3.8-Max-Preview");
    expect(frame.model).toBe("qd/qmodel_preview");
  });

  it("does not overwrite a resolved name the upstream already supplied", () => {
    const inner = '{"model":"auto","x_resolved_model":"upstream-said-this"}';
    expect(JSON.parse(annotateResolvedModel(inner, "Qwen3.8-Max-Preview")).x_resolved_model)
      .toBe("upstream-said-this");
  });
});
