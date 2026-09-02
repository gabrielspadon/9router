import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../docs/design/verification/check-inventory.mjs", import.meta.url),
  "utf8",
);

describe("inventory seed comparison", () => {
  it("accepts explicit baseline and current capture files", () => {
    expect(source).toContain("--before-file");
    expect(source).toContain("--after-file");
  });

  it("picks the baseline by seed digest rather than by filename", () => {
    const summary = readFileSync(
      new URL("../../docs/design/verification/write-summary.mjs", import.meta.url),
      "utf8",
    );
    // Pinning a filename was how a baseline captured from a different seed got
    // reported as same-seed parity. The seed comparison is the assertion; the
    // candidate list is free to change.
    expect(summary).toContain("seedOf(p) === afterSeed");
    expect(summary).toContain("--before-file");
  });

  it("waits for asynchronous quota rows before recording quota controls", () => {
    const inventory = readFileSync(
      new URL("../../docs/design/verification/inventory.mjs", import.meta.url),
      "utf8",
    );
    expect(inventory).toContain("quota: 8000");
  });
});
