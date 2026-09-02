// Issue #3662: a Muse Spark request errored upstream. The tool_choice demotion
// that exists for exactly this model family was gated on provider opencode-go,
// which declares no muse model at all; the Meta provider that declares all
// three landed seven hours after the guard and never inherited it, so
// meta/muse-spark-* still sent a forced tool_choice. The constraint belongs to
// the model, not to whichever provider happened to expose it first.
import { describe, expect, it, beforeEach, vi } from "vitest";

import { DefaultExecutor } from "open-sse/executors/default.js";

// transformRequest(model, body, stream, credentials, sourceFormat) is where the
// demotion lives; construct the executor for the provider under test.
function transform(provider, model, body) {
  return new DefaultExecutor(provider).transformRequest(model, body, false, {}, "openai");
}

describe("Muse Spark never receives a forced tool_choice (#3662)", () => {
  const FORCED = { tool_choice: { type: "function", function: { name: "x" } }, messages: [] };

  it("demotes on the meta provider, which actually declares the model", () => {
    const out = transform("meta", "muse-spark-1.2-contributor", { ...FORCED });
    expect(out.tool_choice).toBe("auto");
  });

  it("still demotes on opencode-go, the route the original guard named", () => {
    const out = transform("opencode-go", "muse-spark-1.2-contributor", { ...FORCED });
    expect(out.tool_choice).toBe("auto");
  });

  it("covers the sibling muse ids the registry declares", () => {
    for (const id of ["muse-spark-1.2", "muse-spark-1.1"]) {
      expect(transform("meta", id, { ...FORCED }).tool_choice).toBe("auto");
    }
  });

  it("sees through a thinking suffix on the model name", () => {
    expect(transform("meta", "muse-spark-1.2(high)", { ...FORCED }).tool_choice).toBe("auto");
  });

  it("leaves an already-auto choice alone", () => {
    const out = transform("meta", "muse-spark-1.2", { tool_choice: "auto", messages: [] });
    expect(out.tool_choice).toBe("auto");
  });

  it("does not add tool_choice to a body that never had one", () => {
    const out = transform("meta", "muse-spark-1.2", { messages: [] });
    expect("tool_choice" in out).toBe(false);
  });

  it("leaves a different model's forced choice untouched", () => {
    const out = transform("meta", "some-other-model", { ...FORCED });
    expect(out.tool_choice).not.toBe("auto");
  });
});
