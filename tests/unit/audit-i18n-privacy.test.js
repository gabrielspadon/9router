import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../docs/design/verification/audit-i18n.mjs", import.meta.url),
  "utf8",
);

describe("localisation evidence privacy", () => {
  it("measures the shipped locale DOM, then masks both screenshots and retained samples", () => {
    const measure = source.indexOf("const m = await p.evaluate(measure)");
    const mask = source.indexOf("await p.evaluate(maskEvidenceDom, privacyContext)");
    const screenshot = source.indexOf("await p.screenshot");

    expect(source).toContain("buildEvidencePrivacyContext");
    expect(source).toContain("privacy context unavailable; refusing to retain evidence");
    expect(source).toContain("redactEvidenceValue");
    expect(measure).toBeGreaterThan(-1);
    expect(mask).toBeGreaterThan(measure);
    expect(screenshot).toBeGreaterThan(mask);
  });
});
