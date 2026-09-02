import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lines = readFileSync(join(root, ".dockerignore"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

describe(".dockerignore excludes nested copies too (#2828)", () => {
  for (const name of ["node_modules", ".next"]) {
    it(`excludes ${name} at any depth, not only the root one`, () => {
      // A bare pattern matches the root entry only. cli/app carries its own
      // node_modules and it is very large, so without the ** form the whole
      // thing is sent to the daemon as build context.
      expect(lines).toContain(name);
      expect(lines).toContain(`**/${name}`);
    });
  }

  it("keeps the .git exclusion in both forms, which it already had", () => {
    expect(lines).toContain(".git");
    expect(lines).toContain("**/.git");
  });
});
