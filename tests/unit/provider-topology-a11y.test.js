import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/app/(dashboard)/dashboard/usage/components/ProviderTopology.js", import.meta.url),
  "utf8",
);

describe("provider topology keyboard access", () => {
  it("keeps non-interactive topology edges out of the tab sequence", () => {
    expect(source).toContain("edgesFocusable={false}");
  });
});
