import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = join(root, "public/i18n/literals");
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

describe("dashboard locale files (#2745)", () => {
  it("there are locale files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    describe(file, () => {
      // A file that fails to parse is caught by the loader and replaced with an
      // EMPTY map, so the locale silently renders entirely in English.
      const raw = readFileSync(join(dir, file), "utf8");
      let data = null;
      it("parses, because a parse failure blanks the whole locale at runtime", () => {
        expect(() => { data = JSON.parse(raw); }).not.toThrow();
        expect(data && typeof data === "object" && !Array.isArray(data)).toBe(true);
      });

      it("has no key that translate() can never match", () => {
        // translate() trims its input before the lookup, so a key with
        // surrounding whitespace is dead weight that never fires.
        const untrimmed = Object.keys(data || {}).filter((k) => k !== k.trim());
        expect(untrimmed).toEqual([]);
      });

      it("maps every key to a string", () => {
        const wrong = Object.entries(data || {}).filter(([, v]) => typeof v !== "string");
        expect(wrong.map(([k]) => k)).toEqual([]);
      });
    });
  }
});
