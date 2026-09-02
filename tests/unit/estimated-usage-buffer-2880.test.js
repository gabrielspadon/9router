import { describe, expect, it, vi } from "vitest";
import { addBufferToUsage, stripBufferFromUsage, formatUsage, estimateUsage } from "../../open-sse/utils/usageTracking.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// The +2000 headroom buffer is deliberate and client-facing. Wire-reported usage
// gets a buffered COPY for the client while the raw value stays on state.usage
// for recording. Estimated usage had no such split: formatUsage baked the buffer
// in, so the same object reached both the client and the cost record.
describe("estimated usage does not bill the client headroom buffer (#2880)", () => {
  it("still hands the client the buffered estimate", () => {
    const est = estimateUsage({ messages: [{ role: "user", content: "hello world" }] }, 40, FORMATS.OPENAI);
    expect(est.estimated).toBe(true);
    const raw = stripBufferFromUsage(est);
    expect(est.prompt_tokens - raw.prompt_tokens).toBe(2000);
  });

  it("strips the buffer from what gets recorded", () => {
    const est = formatUsage(1000, 50, FORMATS.OPENAI);
    const recorded = stripBufferFromUsage(est);
    expect(recorded.prompt_tokens).toBe(1000);
    expect(recorded.total_tokens).toBe(1050);
    expect(recorded.completion_tokens).toBe(50);
  });

  it("handles the claude shape", () => {
    const est = formatUsage(800, 20, FORMATS.CLAUDE);
    expect(stripBufferFromUsage(est).input_tokens).toBe(800);
    expect(stripBufferFromUsage(est).output_tokens).toBe(20);
  });

  it("leaves wire-reported usage untouched", () => {
    // No `estimated` marker → the buffer was never baked in, so nothing to strip.
    const wire = { prompt_tokens: 1234, completion_tokens: 56, total_tokens: 1290 };
    expect(stripBufferFromUsage(wire)).toEqual(wire);
    // And a buffered COPY of wire usage is what the client sees, unchanged.
    expect(addBufferToUsage(wire).prompt_tokens).toBe(3234);
    expect(wire.prompt_tokens).toBe(1234);
  });

  it("floors at zero rather than going negative on a tiny estimate", () => {
    expect(stripBufferFromUsage({ estimated: true, prompt_tokens: 5, total_tokens: 5 }).prompt_tokens).toBe(0);
  });
});

describe("the recording funnel applies the strip (#2880)", () => {
  it("records the de-buffered estimate, not the client-facing one", async () => {
    const saved = [];
    vi.doMock("@/lib/usageDb.js", () => ({
      saveRequestUsage: (row) => { saved.push(row); return Promise.resolve(); },
      appendRequestLog: () => Promise.resolve(),
      saveRequestDetail: () => Promise.resolve(),
    }));
    const { saveUsageStats } = await import("../../open-sse/handlers/chatCore/requestDetail.js");
    saveUsageStats({
      provider: "acme",
      model: "m",
      tokens: formatUsage(1000, 50, FORMATS.OPENAI),
      silent: true,
    });
    expect(saved).toHaveLength(1);
    expect(saved[0].tokens.prompt_tokens).toBe(1000);
    expect(saved[0].tokens.completion_tokens).toBe(50);
  });
});
