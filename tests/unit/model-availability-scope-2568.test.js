import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../../src/app/api/models/availability/route.js", import.meta.url), "utf8");

// testStatus is account-wide but the failure behind it usually is not. One
// model answering "Invalid model ID" left this route reporting __all once its
// short lock expired, and the dashboard marked EVERY model on the connection red
// while showing the one model's error text (#2568). The per-model failure
// records say which models actually failed.
//
// The route is a Next handler over the live DB, so the reduction is
// reimplemented here against fixtures and the wiring is asserted from source.
const MODEL_FAILURE_PREFIX = "modelFailure_";

function unavailableFor(connection) {
  const failed = Object.keys(connection)
    .filter((key) => key.startsWith(MODEL_FAILURE_PREFIX) && connection[key])
    .map((key) => key.slice(MODEL_FAILURE_PREFIX.length) || "__all");
  const scoped = failed.filter((m) => m !== "__all");
  return (scoped.length > 0 ? scoped : ["__all"]).map((model) => ({
    model,
    lastError: connection[`${MODEL_FAILURE_PREFIX}${model}`]?.message || connection.lastError || null,
  }));
}

describe("an unavailable connection names the models that failed (#2568)", () => {
  it("one bad model does not take the whole connection down", () => {
    const rows = unavailableFor({
      testStatus: "unavailable",
      lastError: "Invalid model ID. Please select a different model to continue.",
      "modelFailure_claude-sonnet-5": { status: 400, message: "Invalid model ID." },
    });
    expect(rows.map((r) => r.model)).toEqual(["claude-sonnet-5"]);
  });

  it("several failed models are each reported, with their own error", () => {
    const rows = unavailableFor({
      testStatus: "unavailable",
      lastError: "something generic",
      "modelFailure_claude-sonnet-5": { status: 400, message: "Invalid model ID." },
      "modelFailure_claude-opus-4.8": { status: 400, message: "Something else." },
    });
    expect(rows.map((r) => r.model).sort()).toEqual(["claude-opus-4.8", "claude-sonnet-5"]);
    expect(rows.find((r) => r.model === "claude-sonnet-5").lastError).toBe("Invalid model ID.");
  });

  it("an account-level rejection still reports the whole connection", () => {
    // A 401 or a payment failure genuinely carries no model, and reporting only
    // one model there would hide that nothing on the account works.
    const rows = unavailableFor({
      testStatus: "unavailable",
      lastError: "Unauthorized",
      "modelFailure___all": { status: 401, message: "Unauthorized" },
    });
    expect(rows.map((r) => r.model)).toEqual(["__all"]);
  });

  it("no failure record at all falls back to the whole connection", () => {
    const rows = unavailableFor({ testStatus: "unavailable", lastError: "unknown" });
    expect(rows.map((r) => r.model)).toEqual(["__all"]);
    expect(rows[0].lastError).toBe("unknown");
  });

  it("a cleared failure record is not counted", () => {
    const rows = unavailableFor({
      testStatus: "unavailable",
      lastError: "stale",
      "modelFailure_claude-sonnet-5": null,
    });
    expect(rows.map((r) => r.model)).toEqual(["__all"]);
  });
});

describe("the route uses that scoping", () => {
  it("reads the per-model failure records", () => {
    expect(src).toContain('const MODEL_FAILURE_PREFIX = "modelFailure_";');
    expect(src).toContain("key.startsWith(MODEL_FAILURE_PREFIX)");
  });

  it("only falls back to __all when nothing is scoped", () => {
    expect(src).toContain('scopedModels.length > 0 ? scopedModels : ["__all"]');
  });

  it("active locks are still reported per model, as before", () => {
    expect(src).toContain("getActiveModelLocks");
    expect(src).toMatch(/status: "cooldown"/);
  });
});
