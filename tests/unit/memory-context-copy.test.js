import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const client = readFileSync(
  new URL("../../src/app/(dashboard)/dashboard/memory/MemoryClient.js", import.meta.url),
  "utf8",
);
const page = readFileSync(
  new URL("../../src/app/(dashboard)/dashboard/memory/page.js", import.meta.url),
  "utf8",
);

describe("Memory & Context operator copy", () => {
  it("uses the canonical route name without unmeasured savings claims", () => {
    expect(client).toContain("Memory & Context");
    expect(page).toContain('title: "Memory & Context | TokenProxy"');
    expect(client).not.toMatch(/slashing token costs by/i);
    expect(client).not.toMatch(/70.?85% of input tokens/i);
  });

  it("keeps the ai-memory reference available as secondary documentation", () => {
    expect(client).toContain('href="https://github.com/akitaonrails/ai-memory"');
    expect(client).toContain('target="_blank"');
    expect(client).toMatch(/>\s*ai-memory\s*</);
  });
});
