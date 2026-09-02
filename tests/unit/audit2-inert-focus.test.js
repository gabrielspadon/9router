import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../docs/design/verification/audit2.mjs", import.meta.url),
  "utf8",
);

describe("audit2 inert controls", () => {
  it("excludes inert descendants from accessibility measurements", () => {
    for (const audit of ["auditContrast", "auditNames", "auditFocusRing", "auditHueOnly"]) {
      const start = source.indexOf(`function ${audit}`);
      const end = source.indexOf("\nfunction ", start + 1);
      const body = source.slice(start, end === -1 ? undefined : end);
      expect(body).toContain(
        'const isInert = (el) => Boolean(el.closest("[inert], [aria-hidden=\'true\']"));',
      );
      expect(body).toContain("isInert(el)");
    }
  });

  it("does not treat decorative aria-hidden pixels as status indicators", () => {
    const start = source.indexOf("function auditHueOnly");
    expect(source.slice(start)).toContain('el.closest("[aria-hidden=\'true\']")');
  });

  it("audits the shipped DOM before masking private screenshot text without pausing virtual time", () => {
    const visit = source.indexOf("async function visit");
    const mask = source.indexOf("await page.evaluate(maskEvidenceDom", visit);
    const freeze = source.indexOf('Emulation.setScriptExecutionDisabled", { value: true }', visit);
    expect(source.indexOf("await page.evaluate(auditContrast)", visit)).toBeLessThan(mask);
    expect(source.indexOf("Emulation.setVirtualTimePolicy", visit)).toBe(-1);
    expect(freeze).toBeGreaterThan(mask);
    expect(source.indexOf("await page.screenshot", visit)).toBeGreaterThan(freeze);
  });

  it("redacts captured audit records after measuring the shipped DOM", () => {
    const visit = source.indexOf("async function visit");
    expect(source.indexOf("const evidence = redactEvidenceValue(r, privacyContext)", visit)).toBeGreaterThan(
      source.indexOf("r.tabOrder =", visit)
    );
    expect(source).toContain("results.routes[`${name}|${theme}|${tag}`] = evidence;");
  });

  it("checks every visible focus target, reports body escape separately, and resets capture scroll", () => {
    expect(source).toContain("page.evaluate(auditFocusRing)");
    expect(source).not.toContain("page.evaluate(auditFocusRing, 25)");
    expect(source).toContain("r.tabOrder = { steps: seq.length, escaped, unnamed:");
    expect(source).toContain("await page.evaluate(() => window.scrollTo(0, 0));");
  });

  // `truncate` carries `overflow: hidden`, so a truncated control with `hit-44`
  // computes a 44px overlay and hands the user a box the size of its text.
  // Crediting that measures a pass the pointer cannot reach, which is worse
  // than the shortfall it hides.
  it("does not credit a hit-target overlay that its own element clips", () => {
    const start = source.indexOf("function auditHitTargets");
    const body = source.slice(start, source.indexOf("\nfunction ", start + 1));
    expect(body).toContain(
      'const clips = cs.overflow !== "visible" || cs.overflowX !== "visible" || cs.overflowY !== "visible";',
    );
    expect(body).toContain("const after = replaced || clips ? null : getComputedStyle(el, \"::after\");");
  });

  it("can omit a current-only route when recapturing the matching baseline", () => {
    expect(source).toContain('const SKIP = process.env.SKIP_ROUTE || "";');
    expect(source).toContain('!SKIP || n !== SKIP');
  });
});
