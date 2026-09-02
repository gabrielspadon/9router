import { describe, it, expect, beforeEach } from "vitest";
import { getRotatedModels, peekRotatedModels, resetComboRotation } from "open-sse/services/combo.js";

const MODELS = ["openai/gpt-4o-mini", "anthropic/claude-3-5-sonnet", "google/gemini-1.5-pro"];

describe("peekRotatedModels (#3404 combo batch test)", () => {
  beforeEach(() => {
    resetComboRotation();
  });

  it("documents that getRotatedModels advances the live cursor on every call", () => {
    expect(getRotatedModels(MODELS, "combo-a", "round-robin", 1)).toEqual(MODELS);
    expect(getRotatedModels(MODELS, "combo-a", "round-robin", 1)[0]).toBe(MODELS[1]);
    expect(getRotatedModels(MODELS, "combo-a", "round-robin", 1)[0]).toBe(MODELS[2]);
  });

  it("returns the same order repeatedly without advancing the cursor", () => {
    expect(peekRotatedModels(MODELS, "combo-a", "round-robin")).toEqual(MODELS);
    expect(peekRotatedModels(MODELS, "combo-a", "round-robin")).toEqual(MODELS);
    expect(peekRotatedModels(MODELS, "combo-a", "round-robin")).toEqual(MODELS);
  });

  it("leaves live routing on the model it was already going to serve", () => {
    // Live traffic moves the cursor to index 1.
    getRotatedModels(MODELS, "combo-a", "round-robin", 1);

    // A diagnostic (one test click, or a batch test over many combos) must not.
    for (let i = 0; i < 5; i++) peekRotatedModels(MODELS, "combo-a", "round-robin");

    expect(getRotatedModels(MODELS, "combo-a", "round-robin", 1)[0]).toBe(MODELS[1]);
  });

  it("reports the order live traffic would actually get next", () => {
    getRotatedModels(MODELS, "combo-b", "round-robin", 1);
    const peeked = peekRotatedModels(MODELS, "combo-b", "round-robin");
    expect(getRotatedModels(MODELS, "combo-b", "round-robin", 1)).toEqual(peeked);
  });

  it("honours a sticky limit that is holding the cursor in place", () => {
    getRotatedModels(MODELS, "combo-c", "round-robin", 3);
    expect(peekRotatedModels(MODELS, "combo-c", "round-robin")).toEqual(MODELS);
  });

  it("passes non-rotating input straight through", () => {
    expect(peekRotatedModels(MODELS, "combo-a", "fallback")).toEqual(MODELS);
    expect(peekRotatedModels(MODELS, "combo-a", "fusion")).toEqual(MODELS);
    expect(peekRotatedModels(["only/one"], "combo-a", "round-robin")).toEqual(["only/one"]);
    expect(peekRotatedModels(null, "combo-a", "round-robin")).toBe(null);
  });

  it("reads a rotation state that getRotatedModels advanced twice", () => {
    getRotatedModels(MODELS, "combo-d", "round-robin", 1);
    getRotatedModels(MODELS, "combo-d", "round-robin", 1);
    expect(peekRotatedModels(MODELS, "combo-d", "round-robin")[0]).toBe(MODELS[2]);
  });
});
