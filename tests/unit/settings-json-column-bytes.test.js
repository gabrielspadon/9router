import { describe, it, expect } from "vitest";
import { parseJson, stringifyJson } from "../../src/lib/db/helpers/jsonCol.js";

// Regression for a live settings row that was destroyed in place. The driver
// handed the JSON column back as bytes, parseJson returned them unparsed
// because a Buffer is `typeof "object"`, and the caller's `{ ...current }`
// spread turned the row into one key per byte before writing it back. Every
// named setting reverted to its default, and the dashboard password hash went
// with it, which put the gateway back on its public default password.
describe("parseJson byte columns", () => {
  const settings = { password: "$2b$10$hash", requireLogin: true, port: 20127 };
  const text = stringifyJson(settings);

  const shapes = [
    ["text", text],
    ["Buffer", Buffer.from(text, "utf8")],
    ["Uint8Array", new TextEncoder().encode(text)],
  ];

  for (const [name, column] of shapes) {
    it(`parses a ${name} column to the same object`, () => {
      expect(parseJson(column, {})).toEqual(settings);
    });

    it(`spreading a parsed ${name} column yields no per-byte keys`, () => {
      const spread = { ...parseJson(column, {}) };
      const byteKeys = Object.keys(spread).filter((k) => /^\d+$/.test(k));
      expect(byteKeys).toEqual([]);
      // The half that actually got lost: a spread of raw bytes keeps none of
      // the named keys, so this is what a re-write would have persisted.
      expect(spread.password).toBe(settings.password);
    });
  }

  it("still passes an already-parsed object through untouched", () => {
    const parsed = { a: 1 };
    expect(parseJson(parsed, {})).toBe(parsed);
  });

  it("falls back rather than throwing when the bytes are not JSON", () => {
    expect(parseJson(Buffer.from("not json", "utf8"), { fallback: true })).toEqual({
      fallback: true,
    });
  });

  it("returns the fallback for null and undefined", () => {
    expect(parseJson(null, { f: 1 })).toEqual({ f: 1 });
    expect(parseJson(undefined, { f: 1 })).toEqual({ f: 1 });
  });
});
