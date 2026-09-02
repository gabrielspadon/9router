import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const ROUTES = [
  "src/app/api/combos/test/route.js",
  "src/app/api/combos/[id]/test/route.js",
];

describe("combo test routes do not consume a rotation turn (#3404)", () => {
  for (const route of ROUTES) {
    it(`${route} peeks instead of rotating`, () => {
      const src = read(route);
      expect(src).toContain("peekRotatedModels");
      // getRotatedModels writes comboRotationState, so pressing Test would
      // shift the order real traffic sees.
      expect(src).not.toContain("getRotatedModels");
    });
  }
});
