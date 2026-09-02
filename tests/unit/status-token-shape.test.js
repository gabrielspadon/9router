import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/shared/components/StatusToken.js", import.meta.url),
  "utf8",
);

describe("status token glyphs", () => {
  // Status must survive colour blindness, a monochrome print and a screenshot
  // pasted into a ticket, which it only does if each tone has its own shape.
  // `degraded` and `failing` shared a triangle until the provider health
  // matrix rendered both in one column and the collision became visible.
  it("gives every tone a glyph no other tone uses", () => {
    const glyphs = [...source.matchAll(/glyph: "(.)"/g)].map((m) => m[1]);
    expect(glyphs.length).toBeGreaterThanOrEqual(6);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});
