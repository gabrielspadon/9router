import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/shared/components/Header.js", import.meta.url),
  "utf8",
);

describe("Header phone search layout", () => {
  it("renders one provider search in a dedicated phone row", () => {
    expect(source.match(/<HeaderSearch \/>/g)).toHaveLength(1);
    expect(source).toContain('className="order-last basis-full lg:order-none lg:basis-auto"');
    expect(source).toContain('className="relative w-full lg:w-[220px]"');
    expect(source).toContain('className="flex min-w-0 items-center gap-2"');
  });
});
