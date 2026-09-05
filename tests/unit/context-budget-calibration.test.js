import { describe, it, expect } from "vitest";
import {
  measureContextPressure,
  calibrationFactor,
  estimateRequestTokens,
  CHARS_PER_TOKEN,
} from "../../open-sse/services/memory/contextBudget.js";

// The character estimate is a guess at what the provider will count; the
// calibration factor is the provider's own count divided by that guess for
// the session's previous request. Pressure is measured in calibrated tokens
// and the deficit converted back to characters with the same factor.
describe("context budget calibration", () => {
  const body = { messages: [{ role: "user", content: "x".repeat(38_000) }] };

  it("factor 1 by default and bounded to [0.5, 4]", () => {
    expect(calibrationFactor(undefined)).toBe(1);
    expect(calibrationFactor(0)).toBe(1);
    expect(calibrationFactor("nope")).toBe(1);
    expect(calibrationFactor(0.1)).toBe(0.5);
    expect(calibrationFactor(9)).toBe(4);
    expect(calibrationFactor(1.6)).toBe(1.6);
  });

  it("scales the projected size and the character deficit together", () => {
    const base = measureContextPressure(body, { contextWindow: 20_000 });
    const cal = measureContextPressure(body, { contextWindow: 20_000, calibration: 2 });
    expect(base.projected).toBe(estimateRequestTokens(body));
    expect(cal.projected).toBe(Math.ceil(estimateRequestTokens(body) * 2));
    expect(cal.calibration).toBe(2);
    // Twice the tokens per character means half the characters per token.
    expect(cal.deficitChars).toBe(Math.ceil(cal.deficitTokens * (CHARS_PER_TOKEN / 2)));
    expect(cal.deficitTokens).toBeGreaterThan(base.deficitTokens);
  });

  it("a request that fits uncalibrated can be over budget once calibrated", () => {
    const small = { messages: [{ role: "user", content: "y".repeat(30_000) }] };
    const base = measureContextPressure(small, { contextWindow: 20_000 });
    const cal = measureContextPressure(small, { contextWindow: 20_000, calibration: 1.6 });
    expect(base.over).toBe(false);
    expect(cal.over).toBe(true);
  });
});
