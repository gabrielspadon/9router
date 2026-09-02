import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const page = read("../../src/app/(dashboard)/dashboard/providers/page.js");
const batch = read("../../src/app/api/providers/test-batch/route.js");

// Every provider section had a Test All except Custom Providers, which offered
// only "Add ..." buttons — so the one group most likely to hold a misconfigured
// endpoint was the one that could not be checked in bulk (#3505).
describe("Custom Providers has a Test All (#3505)", () => {
  it("the button sends the mode the endpoint already accepts", () => {
    expect(page).toContain('handleBatchTest("compatible")');
    expect(batch).toContain('} else if (mode === "compatible") {');
    expect(batch).toContain("connectionsToTest = allConnections.filter((c) => isCompatibleProvider(c.provider));");
  });

  it("no new endpoint or mode was invented", () => {
    // "compatible" was already in the documented mode list; nothing server-side
    // changed for this.
    expect(batch).toContain("Use: provider, oauth, free, apikey, compatible, all");
  });

  it("it shares the one-at-a-time guard with the other Test All buttons", () => {
    const i = page.indexOf('handleBatchTest("compatible")');
    const around = page.slice(i - 400, i + 400);
    expect(around).toContain('loading={testingMode === "compatible"}');
    expect(around).toContain("disabled={!!testingMode}");
  });

  it("it carries an accessible name, being icon-and-text in a row of buttons", () => {
    const i = page.indexOf('handleBatchTest("compatible")');
    expect(page.slice(i - 400, i + 400)).toContain('aria-label="Test all custom provider connections"');
  });

  it("the three pre-existing Test All buttons are untouched", () => {
    for (const mode of ["oauth", "free", "apikey"]) {
      expect(page).toContain(`handleBatchTest("${mode}")`);
    }
  });
});
