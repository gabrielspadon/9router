import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/shared/components/Pagination.js", import.meta.url),
  "utf8",
);

describe("Pagination", () => {
  it("names icon-only page navigation controls", () => {
    expect(source).toContain('aria-label="Previous page"');
    expect(source).toContain('aria-label="Next page"');
  });
});
