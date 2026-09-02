import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const strip = readFileSync(resolve(root, "src/app/(dashboard)/dashboard/home/EndpointHandoff.js"), "utf8");
const masthead = readFileSync(resolve(root, "src/app/(dashboard)/dashboard/home/SystemMasthead.js"), "utf8");
const layout = readFileSync(resolve(root, "src/shared/components/layouts/DashboardLayout.js"), "utf8");

// direction.md signature element 5: the one URL a client needs, with copy and a
// ready-made request, reachable from the masthead on every route. It was named
// in the direction document and existed nowhere in source.
describe("endpoint handoff strip", () => {
  it("is rendered by the masthead, which the shell renders on every route", () => {
    expect(masthead).toContain("<EndpointHandoff />");
    expect(layout).toContain("<SystemMasthead />");
  });

  it("offers the URL and a ready-made request, not a description of one", () => {
    expect(strip).toMatch(/Copy URL/);
    expect(strip).toMatch(/Copy request/);
    expect(strip).toMatch(/curl \$\{base\}\/chat\/completions/);
    expect(strip).toMatch(/Authorization: Bearer/);
  });

  it("resolves the origin at runtime rather than baking one in", () => {
    expect(strip).toMatch(/useSyncExternalStore\(/);
    expect(strip).toMatch(/window\.location\.origin/);
    expect(strip).toMatch(/const RELATIVE_BASE = "\/v1"/);
    // The server snapshot has to be the relative form, or the first paint on
    // the server would name an origin the server cannot know.
    expect(strip).toMatch(/serverBase = \(\) => RELATIVE_BASE/);
  });

  it("announces the copy result instead of relying on the label change alone", () => {
    expect(strip).toMatch(/aria-live="polite"/);
  });

  it("routes every visible string through translate", () => {
    for (const s of ["Endpoint", "Copy URL", "Copy request", "Copied", "Keys and tunnel"]) {
      expect(strip).toContain(`translate("${s}")`);
    }
  });
});
