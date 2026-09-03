import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../../open-sse/executors/codex.js";
import { normalizeCodexServiceTier } from "../../../open-sse/config/codexFastMode.js";

// G1 tier fidelity. Codex defines exactly three service tiers. The gateway used
// to keep `priority` and delete everything else, so a client asking for
// `default` or `ultrafast` silently got Codex's own default instead of the tier
// it paid for. Normalization now happens once, in normalizeCodexServiceTier, and
// CodexExecutor.transformRequest is the only outbound caller.

const CODEX_MODEL = "gpt-5.6-sol";

function outbound(serviceTier) {
  const body = { model: CODEX_MODEL, input: "hi" };
  if (arguments.length > 0) body.service_tier = serviceTier;
  return new CodexExecutor().transformRequest(CODEX_MODEL, body, true, {});
}

describe("G1 Codex service tier fidelity", () => {
  it.each(["default", "priority", "ultrafast"])(
    "forwards first-class tier %s byte-for-byte",
    (tier) => {
      expect(outbound(tier).service_tier).toBe(tier);
    },
  );

  it("resolves the `fast` alias to priority and never emits `fast`", () => {
    const body = outbound("fast");
    expect(body.service_tier).toBe("priority");
    expect(body.service_tier).not.toBe("fast");
  });

  it("keeps `fast` an alias rather than a fourth first-class tier", () => {
    // The alias exists only as an input spelling: it resolves to an existing
    // tier and is not itself a value the normalizer can ever return.
    const outputs = new Set(
      ["default", "priority", "ultrafast", "fast"].map((t) =>
        normalizeCodexServiceTier(t),
      ),
    );
    expect([...outputs].sort()).toEqual(["default", "priority", "ultrafast"]);
  });

  it.each(["flex", "scale", "Priority", "PRIORITY", "ultra", ""])(
    "omits unrecognized tier %j instead of remapping it",
    (tier) => {
      expect(outbound(tier)).not.toHaveProperty("service_tier");
    },
  );

  it.each([[null], [undefined], [123], [true], [{}], [[]]])(
    "omits non-string tier %j (fails by omission, never null)",
    (tier) => {
      const body = outbound(tier);
      expect(body).not.toHaveProperty("service_tier");
      expect(normalizeCodexServiceTier(tier)).toBeUndefined();
    },
  );

  it("tolerates surrounding whitespace on a real tier", () => {
    expect(outbound("  ultrafast  ").service_tier).toBe("ultrafast");
  });

  it("emits no tier at all when the request carries none", () => {
    const body = new CodexExecutor().transformRequest(
      CODEX_MODEL,
      { model: CODEX_MODEL, input: "hi" },
      true,
      {},
    );
    expect(body).not.toHaveProperty("service_tier");
  });

  it("normalizes exactly once — re-running is a fixed point", () => {
    for (const tier of ["default", "priority", "ultrafast", "fast", "flex"]) {
      const once = normalizeCodexServiceTier(tier);
      expect(normalizeCodexServiceTier(once)).toBe(once);
    }
  });

  it("survives a second transformRequest pass over its own output", () => {
    const first = outbound("default");
    const second = new CodexExecutor().transformRequest(
      CODEX_MODEL,
      { ...first },
      true,
      {},
    );
    expect(second.service_tier).toBe("default");
  });
});
