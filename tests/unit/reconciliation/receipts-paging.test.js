// The receipts audit log must not drop rows, and must not swallow bad input.
//
// F3, measured live: walking /api/admin/receipts with limit=1 returned a
// sequence missing 21 receipt ids that a full read returns. The switch log had
// exactly 21 tied timestamps -- a 1:1 correlation, one row lost per tie. Cause
// is receipts.js beforeCursor(): the cursor was the last row's switchedAt alone
// and the next page filtered `Date.parse(r.switchedAt) < t`, so a tied sibling
// that had not yet been returned was excluded by the strict comparison. The old
// comment claimed "A timestamp cursor cannot skip"; it can, and it did.
//
// F4, measured live: limit=abc, limit=-5, limit=0, since=garbage and
// cursor=garbage all returned the default 50-row page with HTTP 200. A caller
// could not distinguish "your filter matched the default page" from "your
// parameter was thrown away". The ABI types these parameters (limit: number,
// since: date-time), so a malformed one is a 400.
import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({ current: [] }));

vi.mock("@/lib/db/repos/accountSwitchRepo.js", () => ({
  listSwitches: vi.fn(async ({ connectionId } = {}) =>
    rows.current.filter((r) =>
      connectionId ? r.fromConnectionId === connectionId || r.toConnectionId === connectionId : true
    )
  ),
}));

const { queryReceipts, pageLimit, ReceiptQueryError } = await import("@/lib/admin/receipts.js");

// Three timestamps, six rows: two clean and four spread across two ties. Paging
// one row at a time has to return all six exactly once.
const fixture = () => [
  { id: "a", switchedAt: "2026-09-03T10:40:27.377Z", model: "m", toConnectionId: "c1", trigger: "reset" },
  { id: "b", switchedAt: "2026-09-03T10:40:27.377Z", model: "m", toConnectionId: "c1", trigger: "reset" },
  { id: "c", switchedAt: "2026-09-03T10:30:00.000Z", model: "m", toConnectionId: "c1", trigger: "reset" },
  { id: "d", switchedAt: "2026-09-03T10:11:44.111Z", model: "m", toConnectionId: "c1", trigger: "reset" },
  { id: "e", switchedAt: "2026-09-03T10:11:44.111Z", model: "m", toConnectionId: "c1", trigger: "reset" },
  { id: "f", switchedAt: "2026-09-03T10:00:00.000Z", model: "m", toConnectionId: "c1", trigger: "reset" },
];

async function walk(limit, extra = {}) {
  const seen = [];
  let cursor = null;
  for (let guard = 0; guard < 100; guard++) {
    const page = await queryReceipts({ ...extra, limit, cursor });
    seen.push(...page.receipts.map((r) => r.receiptId ?? r.id));
    if (!page.nextCursor) return seen;
    cursor = page.nextCursor;
  }
  throw new Error("cursor never terminated");
}

beforeEach(() => {
  rows.current = fixture();
});

describe("G-RECEIPTS F3 - a paginated audit log returns every row exactly once", () => {
  it("loses no row to a tied timestamp when paging one at a time", async () => {
    const seen = await walk(1);
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  });

  it("agrees with a full read, in the same order, at every page size", async () => {
    const full = (await queryReceipts({ limit: 200 })).receipts.map((r) => r.receiptId ?? r.id);
    expect(full).toHaveLength(6);
    for (const size of [1, 2, 3, 4, 5, 6]) {
      expect(await walk(size), `page size ${size}`).toEqual(full);
    }
  });

  it("keeps a tie stable rather than leaving it to arbitrary repo order", async () => {
    const first = (await queryReceipts({ limit: 200 })).receipts.map((r) => r.receiptId ?? r.id);
    rows.current = [...fixture()].reverse();
    const second = (await queryReceipts({ limit: 200 })).receipts.map((r) => r.receiptId ?? r.id);
    // Same rows in a different repo order must produce the same total order, or
    // the cursor means something different on each request.
    expect(second).toEqual(first);
  });

  it("issues an opaque cursor, not a bare timestamp a caller could hand-craft", async () => {
    const page = await queryReceipts({ limit: 1 });
    expect(page.nextCursor).toBeTruthy();
    expect(Date.parse(page.nextCursor)).toBeNaN();
  });
});

describe("G-RECEIPTS F4 - a typed parameter is validated, never silently dropped", () => {
  it("rejects a non-numeric, zero, negative or fractional limit", async () => {
    for (const bad of ["abc", "-5", "0", "NaN", "1.5", ""]) {
      await expect(queryReceipts({ limit: bad }), `limit=${bad}`).rejects.toThrow(ReceiptQueryError);
    }
  });

  it("rejects an unparseable since", async () => {
    await expect(queryReceipts({ since: "garbage" })).rejects.toThrow(ReceiptQueryError);
  });

  it("rejects a malformed cursor instead of restarting from the top", async () => {
    // The dangerous one: silently restarting the walk makes an audit client
    // re-read page 1 forever and believe it reached the end.
    for (const bad of ["garbage", "!!!!", "2026-09-03T10:40:27.377Z"]) {
      await expect(queryReceipts({ cursor: bad }), `cursor=${bad}`).rejects.toThrow(ReceiptQueryError);
    }
  });

  it("still accepts an absent parameter and the documented defaults", async () => {
    const page = await queryReceipts({});
    expect(page.receipts).toHaveLength(6);
    expect(pageLimit(null)).toBe(50);
    expect(pageLimit(undefined)).toBe(50);
  });

  it("clamps an oversized limit rather than erroring, and says so", async () => {
    // A deliberate clamp: the ABI documents no upper bound, so the safe
    // direction is a capped page, not a refusal.
    expect(pageLimit("100000")).toBe(200);
    expect(pageLimit("1e9")).toBe(200);
  });

  it("accepts a valid since and filters on it", async () => {
    const page = await queryReceipts({ since: "2026-09-03T10:30:00.000Z" });
    // Total order is (switchedAt DESC, id DESC), so the 10:40:27.377 tie is b then a.
    expect(page.receipts.map((r) => r.receiptId ?? r.id)).toEqual(["b", "a", "c"]);
  });
});
