import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");

describe("radius and shadow tokens", () => {
  it("re-points Tailwind's radius scale at the brand values", () => {
    for (const step of ["sm", "md", "lg", "xl", "2xl", "3xl"]) {
      expect(css).toMatch(new RegExp(`--radius-${step}: var\\(--radius-brand(-lg)?\\);`));
    }
  });

  it("keeps the brand radius at the 3px the design system names", () => {
    expect(css).toMatch(/--radius-brand: 3px;/);
  });

  it("declares no shadow token that nothing uses", () => {
    expect(css).not.toMatch(/--shadow-warm/);
    expect(css).not.toMatch(/--shadow-elevated/);
  });
});
