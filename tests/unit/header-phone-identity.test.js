import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const header = readFileSync(
  new URL("../../src/shared/components/Header.js", import.meta.url),
  "utf8",
);
const language = readFileSync(
  new URL("../../src/shared/components/HeaderLanguage.js", import.meta.url),
  "utf8",
);

describe("phone header identity", () => {
  it("keeps a route title to one line while retaining the language name for assistive technology", () => {
    expect(header).toContain("gap-2 px-4 lg:gap-3 lg:flex-nowrap lg:px-8");
    expect(header).toContain('className="hidden sm:inline shrink-0"');
    expect(header).toContain('className="material-symbols-outlined text-brand text-xl"');
    expect(header).toContain("text-base lg:text-lg font-semibold tracking-tight text-text-main min-w-0 truncate");
    expect(language).toContain('className="hidden sm:inline truncate text-xs font-medium"');
    expect(language).toContain("aria-label={`Language: ${name}`}");
  });
});
