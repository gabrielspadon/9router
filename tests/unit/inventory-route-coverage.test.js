import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../docs/design/verification/inventory.mjs", import.meta.url),
  "utf8",
);
const audit = readFileSync(
  new URL("../../docs/design/verification/audit2.mjs", import.meta.url),
  "utf8",
);
const checker = readFileSync(
  new URL("../../docs/design/verification/check-inventory.mjs", import.meta.url),
  "utf8",
);

describe("verification inventory route coverage", () => {
  it("captures the reachable new-provider workflow", () => {
    expect(source).toContain('["providers-new", "/dashboard/providers/new"]');
  });

  it("can omit a newly added route when reproducing a historical baseline", () => {
    expect(source).toContain('const SKIP = process.env.SKIP_ROUTE || "";');
  });

  it("does not count a non-interactive topology group as a capability", () => {
    expect(source).toContain('if (role === "group") continue;');
  });

  it("runs responsive checks for the provider setup and a real provider detail", () => {
    expect(audit).toContain('["providers-new", "/dashboard/providers/new"]');
    expect(audit).toContain('["provider-claude", "/dashboard/providers/claude"]');
  });

  it("masks private evidence after measurement and before persistence", () => {
    expect(audit).toContain("await page.evaluate(maskEvidenceDom");
    expect(source).toContain("redactInventoryRecords");
    expect(source).not.toContain("page.evaluate(maskEvidenceText)");
    expect(source.indexOf("const flat = await page.evaluate(collect, 0)")).toBeLessThan(
      source.indexOf("redactInventoryRecords(")
    );
  });

  it("does not classify a lone baseline error-boundary reload as a product capability", () => {
    expect(checker).toContain("function isErrorRecoveryOnly");
    expect(checker).toContain("baseline error fallbacks ignored");
  });
});
