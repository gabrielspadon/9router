import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { getModelUpstreamId, isValidModel } from "../../open-sse/config/providerModels.js";
import { resolveKiroModel } from "../../open-sse/config/kiroConstants.js";
import KIRO from "../../open-sse/providers/registry/kiro.js";

// #2308 claims tokenproxy rewrites dotted Claude ids and that the dot is what Kiro
// rejects with INVALID_MODEL_ID. This file pins what the request path ACTUALLY
// sends, because that claim does not survive contact with it:
//
//   * the reporter's own follow-up used `kr/claude-sonnet-5`, which contains no
//     dot at any stage and is transformed by nothing on the way to the wire, yet
//     still returned INVALID_MODEL_ID. A spelling transform cannot explain a
//     failure on an id that is never transformed.
//   * a dotted id such as `claude-sonnet-4.5` is passed through verbatim, not
//     dashed, so there is no dot-to-dash step to blame either.
//
// What the router does do is normalize a DASHED client id onto the registry's
// own dotted spelling for lookup, then send that registry id upstream. Whether
// that spelling matches Kiro is a question about the hand-maintained registry
// below, not about a translation bug -- and settling it needs the live
// ListAvailableModels body, which this repo has no capture of. These assertions
// exist so a future pass fixes the registry with evidence rather than widening
// resolveKiroModel's regex, which would dash EVERY dotted Claude id and break
// the ids the registry already publishes.

/** The id string that actually reaches the Kiro executor for a client model. */
const onTheWire = (clientModel) =>
  resolveKiroModel(getModelUpstreamId("kr", clientModel)).upstream;

/** modelId as embedded in the real Kiro request body. */
const bodyModelId = (clientModel) =>
  translateRequest(
    FORMATS.OPENAI,
    FORMATS.KIRO,
    getModelUpstreamId("kr", clientModel),
    { messages: [{ role: "user", content: "hi" }] },
    true,
    null,
    "kiro",
  ).conversationState.currentMessage.userInputMessage.modelId;

describe("Kiro model id spelling on the wire (#2308)", () => {
  it("passes claude-sonnet-5 through untouched, so no transform can explain its rejection", () => {
    // The exact id from the #2308 follow-up comment. Identity at every stage.
    expect(getModelUpstreamId("kr", "claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(onTheWire("claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(bodyModelId("claude-sonnet-5")).toBe("claude-sonnet-5");
  });

  it.each(["claude-sonnet-4.5", "claude-haiku-4.5", "claude-opus-4.8"])(
    "sends %s with its dot intact rather than dashing it",
    (model) => {
      expect(onTheWire(model)).toBe(model);
      expect(bodyModelId(model)).toBe(model);
    },
  );

  it("normalizes a dashed client id onto the registry spelling, then sends that", () => {
    // This is the one real rewrite, and it is a lookup convenience: the client
    // may spell it either way, the registry id is what goes upstream.
    expect(isValidModel("kr", "claude-sonnet-4-5")).toBe(true);
    expect(onTheWire("claude-sonnet-4-5")).toBe("claude-sonnet-4.5");
  });

  it("strips the synthetic thinking suffix without disturbing the version separator", () => {
    // -thinking / -agentic are tokenproxy fictions; Kiro never sees them.
    expect(onTheWire("claude-sonnet-4.5-thinking")).toBe("claude-sonnet-4.5");
    expect(onTheWire("claude-sonnet-5-thinking-agentic")).toBe("claude-sonnet-5");
  });

  it("leaves every registry id byte-identical on the wire", () => {
    // The regex in resolveKiroModel only fires on letter-dot-digit
    // (claude-sonnet.5). Nothing the registry publishes has that shape, so a
    // rejection is the registry disagreeing with Kiro's catalog, not a rewrite.
    const rewritten = KIRO.models
      .map((m) => m.id)
      .filter((id) => resolveKiroModel(id).upstream !== id.replace(/-(thinking|agentic)/g, ""));
    expect(rewritten).toEqual([]);
  });
});
