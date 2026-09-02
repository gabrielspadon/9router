import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../docs/design/verification/write-summary.mjs", import.meta.url),
  "utf8",
);

describe("verification summary audit provenance", () => {
  it("discloses when a failed baseline route limits before-and-after claims", () => {
    expect(source).toContain("Audit comparability");
    expect(source).toContain("baseline navigation failure");
  });
});
