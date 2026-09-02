import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../docs/design/verification/write-summary.mjs", import.meta.url),
  "utf8",
);

describe("verification summary performance disclosure", () => {
  it("links measured browser performance instead of implying a budget pass", () => {
    expect(source).toContain("performance-report.json");
    expect(source).toContain("Budget gaps remain explicit");
  });
});
