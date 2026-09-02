import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/shared/components/Button.js", import.meta.url),
  "utf8",
);

describe("Button sizes", () => {
  // A fixed height clipped a label that wrapped, which is what a long
  // translation or 200 percent zoom produces. The pill has to grow.
  it("states height as a minimum so a wrapped label is not clipped", () => {
    for (const size of ["sm", "md", "lg"]) {
      const line = source.match(new RegExp(`^\\s*${size}: "([^"]+)"`, "m"));
      expect(line, `size ${size} is missing`).toBeTruthy();
      expect(line[1]).toMatch(/\bmin-h-\d+/);
      expect(line[1]).not.toMatch(/(?:^|\s)h-\d+/);
    }
  });

  // An icon-only button is square by definition and carries no label to wrap,
  // so `size-` is correct there and must not be "fixed" into a minimum.
  it("keeps icon-only sizes square", () => {
    expect(source).toMatch(/icon: "size-8/);
    expect(source).toMatch(/"icon-sm": "size-6/);
  });
});
