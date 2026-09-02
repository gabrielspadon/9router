import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../../src/lib/db/repos/connectionsRepo.js", import.meta.url), "utf8");

// Reordering connections in the dashboard writes adjacent rows in quick
// succession, so two of them routinely carry the SAME updatedAt to the
// millisecond. Renumbering sorted by priority then updatedAt DESC and nothing
// else, so which write landed first decided the result and a drag could leave
// the list in an order nobody chose (#1181).
//
// The sort is a pure comparator inside a transaction helper; reimplemented here
// against fixtures, with the wiring asserted from source.
const compare = (a, b) => {
  const pDiff = (a.priority || 0) - (b.priority || 0);
  if (pDiff !== 0) return pDiff;
  const tDiff = new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  if (tDiff !== 0) return tDiff;
  return String(a.id).localeCompare(String(b.id));
};
const T = "2026-08-31T12:00:00.000Z";
const order = (rows) => [...rows].sort(compare).map((r) => r.id);

describe("renumbering connections is deterministic (#1181)", () => {
  it("two rows sharing a priority and a timestamp always land the same way", () => {
    const rows = [
      { id: "b", priority: 1, updatedAt: T },
      { id: "a", priority: 1, updatedAt: T },
    ];
    expect(order(rows)).toEqual(["a", "b"]);
    expect(order([...rows].reverse())).toEqual(["a", "b"]);
  });

  it("the result does not depend on the order the rows came back from the DB", () => {
    // The read has no ORDER BY, so input order is whatever SQLite returns.
    const rows = [
      { id: "c", priority: 2, updatedAt: T },
      { id: "a", priority: 2, updatedAt: T },
      { id: "b", priority: 2, updatedAt: T },
    ];
    const permutations = [rows, [rows[2], rows[0], rows[1]], [rows[1], rows[2], rows[0]]];
    for (const p of permutations) expect(order(p)).toEqual(["a", "b", "c"]);
  });

  it("priority still wins over everything", () => {
    expect(order([
      { id: "a", priority: 2, updatedAt: T },
      { id: "z", priority: 1, updatedAt: T },
    ])).toEqual(["z", "a"]);
  });

  it("recency is still preferred when the timestamps actually differ", () => {
    // The id is the LAST resort, not a replacement for the existing preference.
    expect(order([
      { id: "a", priority: 1, updatedAt: "2026-08-31T11:00:00.000Z" },
      { id: "z", priority: 1, updatedAt: "2026-08-31T12:00:00.000Z" },
    ])).toEqual(["z", "a"]);
  });

  it("a missing timestamp does not make the comparator unstable", () => {
    const rows = [{ id: "b", priority: 1 }, { id: "a", priority: 1 }];
    expect(order(rows)).toEqual(["a", "b"]);
    expect(order([...rows].reverse())).toEqual(["a", "b"]);
  });
});

describe("the repo uses that comparator", () => {
  it("reorderInTx breaks a full tie on the id", () => {
    expect(src).toContain('return String(a.id).localeCompare(String(b.id));');
  });

  it("the id tie-break comes after the recency one, not instead of it", () => {
    const i = src.indexOf("const tDiff = new Date(b.updatedAt || 0)");
    expect(i).toBeGreaterThan(0);
    expect(src.indexOf("String(a.id).localeCompare", i)).toBeGreaterThan(i);
  });
});
