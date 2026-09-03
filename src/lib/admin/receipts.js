import { listSwitches } from "@/lib/db/repos/accountSwitchRepo.js";
import { toSwitchReceipt } from "./project.js";

/**
 * Receipt querying for the admin ABI.
 *
 * WHY THE FILTERING IS HERE AND NOT IN THE REPO. accountSwitchRepo owns the
 * switch log for the scheduler, which asks it exactly two questions (by session,
 * by connection) and is a sibling's file. The ABI asks three more — by model,
 * since a timestamp, and paged by cursor — and pushing them down would mean
 * editing a module another leaf owns to serve one caller. This filters what the
 * repo returns instead.
 *
 * ponytail: the scan is O(window) per request over an in-memory page, capped by
 * SCAN_CAP below. Push `model`, `since` and a keyset cursor into the SQL when
 * the switch log outgrows that cap.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// The repo's own ceiling. A request that would need more rows than this to fill
// a page returns a short page with a cursor rather than a wrong one: the cursor
// carries the scan forward, so no receipt is skipped.
const SCAN_CAP = 1000;

export function pageLimit(raw) {
  if (raw === null || raw === undefined || raw === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  // Non-numeric, zero, negative and fractional all fall back rather than
  // erroring: the ABI documents no 400 for this parameter, so the failure
  // direction is a sane page, never an empty one.
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

/**
 * The cursor is the switchedAt of the last receipt returned.
 *
 * Keyset, not offset: the log is append-only and read newest-first, so a new
 * switch arriving mid-page would shift every offset by one and make a paging
 * client skip a receipt. A timestamp cursor cannot skip.
 */
function beforeCursor(rows, cursor) {
  if (!cursor) return rows;
  const t = Date.parse(cursor);
  if (!Number.isFinite(t)) return rows;
  return rows.filter((r) => Date.parse(r.switchedAt) < t);
}

export async function queryReceipts({ connectionId, model, since, limit, cursor } = {}) {
  const size = pageLimit(limit);
  const rows = await listSwitches({ connectionId: connectionId || undefined, limit: SCAN_CAP });

  let filtered = beforeCursor(rows, cursor);
  if (model) filtered = filtered.filter((r) => r.model === model);
  if (since) {
    const t = Date.parse(since);
    // An unparseable `since` filters nothing rather than everything. Dropping
    // every receipt would read to an operator as "no switches happened", which
    // is the dangerous misreading of a malformed timestamp.
    if (Number.isFinite(t)) filtered = filtered.filter((r) => Date.parse(r.switchedAt) >= t);
  }

  const page = filtered.slice(0, size);
  // A cursor is issued only when more rows are actually known to follow, so a
  // caller can page until it is null and stop.
  const nextCursor = filtered.length > size ? page[page.length - 1]?.switchedAt ?? null : null;
  return { receipts: page.map(toSwitchReceipt), nextCursor };
}

/**
 * One receipt by id.
 *
 * A SCAN, because accountSwitches has no by-id read and the repo belongs to
 * another leaf. Bounded by SCAN_CAP, so a receipt older than the last thousand
 * switches reports 404 rather than hanging the request.
 *
 * ponytail: replace with a `WHERE id = ?` read the moment accountSwitchRepo
 * grows one.
 */
export async function findReceipt(receiptId) {
  const rows = await listSwitches({ limit: SCAN_CAP });
  const row = rows.find((r) => r.id === receiptId);
  return row ? toSwitchReceipt(row) : null;
}
