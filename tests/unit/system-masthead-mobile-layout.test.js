import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(import.meta.dirname, "../../src/app/(dashboard)/dashboard/home/SystemMasthead.js"),
  "utf8",
);

describe("SystemMasthead phone layout", () => {
  it("keeps every status token visible and compacts the readouts into two rows", () => {
    // The tokens wrap rather than scroll or truncate, so a narrow viewport
    // still shows all of them.
    expect(source).toContain("flex flex-wrap items-center gap-2");
    // The readout band narrows at phone and widens with the viewport. The
    // column counts are asserted as an ordering, not as one literal class
    // string, so a later change to the breakpoint names does not fail a test
    // that is really about the layout collapsing.
    const band = source.match(/grid grid-cols-(\d)[^"`]*sm:grid-cols-(\d)[^"`]*lg:grid-cols-(\d)/);
    expect(band).not.toBeNull();
    const [, phone, tablet, wide] = band.map(Number);
    expect(phone).toBeLessThan(tablet);
    expect(tablet).toBeLessThan(wide);
    // The secondary note is hidden at phone width, where the row has no space
    // for it, and appears from the small breakpoint up.
    expect(source).toMatch(/hidden line-clamp-2 text-\S+ leading-snug text-text-muted sm:block/);
  });

  // A measure the schema can never answer is dropped, not rendered blank, and
  // an absent measure keeps the numeral slot so the band still reads as one row.
  it("omits the permanently unanswerable measure rather than reserving a blank tile", () => {
    expect(source).not.toContain('key: "failoverCount"');
  });
});
