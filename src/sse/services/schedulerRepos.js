/**
 * The synchronous repos facade `selectAndReserve` requires.
 *
 * THE PROBLEM. Every repo in src/lib/db/repos/ is `async`, because each one
 * starts with `await getAdapter()`. `selectAndReserve` runs its whole decision
 * inside `repos.transaction(fn)`, and `db.transaction(fn)` is SYNCHRONOUS on
 * every adapter (src/lib/db/adapters/betterSqliteAdapter.js:44 is
 * `transaction(fn) { return db.transaction(fn)(); }`). An `await` inside a
 * better-sqlite3 transaction body does not suspend the transaction — it returns
 * a pending promise to the transaction wrapper, which commits immediately, so
 * the read of a free slot and the taking of it stop being indivisible. That is
 * exactly the over-admission rule 6 exists to prevent.
 *
 * THE FIX, which is the pattern this repo already documents at
 * src/lib/db/index.js:139 ("Resolved before the transaction: db.transaction()
 * is synchronous"): resolve the adapter ONCE, before the transaction opens, and
 * hand the scheduler a facade whose four methods are plain synchronous
 * functions closing over that resolved adapter. `await` disappears from the
 * transaction body because the only thing that needed awaiting already happened.
 *
 * The SQL below is deliberately the same SQL the async repos issue, and that
 * duplication is the point rather than an oversight: those repos are the async
 * API for everything outside a transaction (the dashboard, the admin surface,
 * the sweeps), and this is the synchronous API for the one caller that cannot
 * await. Wrapping the async repos here is not possible; re-deriving the
 * statements is what makes the transaction real.
 */

// randomUUID is imported statically: a dynamic import inside recordSwitch would
// be an await in the transaction body, which is the whole thing this module
// exists to avoid.
import { randomUUID } from 'node:crypto';
import { getAdapter } from '@/lib/db/driver.js';

// A pin past its TTL is not a pin — the same rule sessionAffinityRepo.js:41
// enforces, restated here because this facade issues its own SQL. Failure
// direction (issue 03): a missing, expired or malformed pin makes the session
// read as NEW so ranking runs. It never falls through to arbitrary order.
function livePin(row, nowIso) {
  if (!row) return null;
  if (typeof row.connectionId !== 'string' || row.connectionId === '') return null;
  if (typeof row.expiresAt === 'string' && row.expiresAt !== '' && row.expiresAt <= nowIso) return null;
  return { connectionId: row.connectionId, pinnedAt: row.pinnedAt ?? null };
}

/**
 * Build the four-method surface `selectAndReserve` is documented to take.
 *
 * @param {{now?: Date|number}} [options] - injected clock for the TTL check and
 *   for `lastSeenAt`, so a scheduling decision stays reproducible.
 * @returns {Promise<{transaction: Function, getPin: Function, setPin: Function,
 *   recordSwitch: Function}>} every method SYNCHRONOUS. The promise is the
 *   adapter resolution, and it is resolved before the transaction opens.
 */
export async function createSchedulerRepos({ now = Date.now() } = {}) {
  // The one await. Everything returned below is synchronous by construction.
  const db = await getAdapter();
  const nowIso = new Date(typeof now === 'number' ? now : now.getTime()).toISOString();

  return {
    transaction(fn) {
      return db.transaction(fn);
    },

    getPin({ sessionHash, model } = {}) {
      if (!sessionHash || !model) return null;
      const row = db.get(
        `SELECT connectionId, pinnedAt, expiresAt FROM sessionAffinity
         WHERE sessionHash = ? AND model = ?`,
        [sessionHash, model]
      );
      return livePin(row, nowIso);
    },

    // Upsert, matching sessionAffinityRepo.setPin: a repin targets a session
    // that is already pinned by definition, so a second row for one
    // (session, model) would be two answers to a question with one answer.
    setPin({ sessionHash, model, connectionId, at } = {}) {
      if (!sessionHash || !model || !connectionId) return null;
      const pinnedAt = typeof at === 'string' && at !== '' ? at : nowIso;
      db.run(
        `INSERT INTO sessionAffinity(sessionHash, model, connectionId, providerNode, pinnedAt, expiresAt, lastSeenAt)
         VALUES(?, ?, ?, NULL, ?, NULL, ?)
         ON CONFLICT(sessionHash, model) DO UPDATE SET
           connectionId = excluded.connectionId,
           pinnedAt = excluded.pinnedAt,
           lastSeenAt = excluded.lastSeenAt`,
        [sessionHash, model, connectionId, pinnedAt, nowIso]
      );
      return { connectionId, pinnedAt };
    },

    // Append-only, matching accountSwitchRepo.recordSwitch. The receipt arrives
    // from buildSwitchReceipt, whose `at` is this module's `switchedAt`; the
    // rename happens here rather than in the scheduler because the column name
    // is this layer's concern.
    recordSwitch(receipt) {
      if (!receipt || typeof receipt !== 'object') return null;
      const { sessionHash, model, toConnectionId } = receipt;
      // The three fields with no defensible default — a receipt missing any of
      // them cannot answer "which session, on which model, went where".
      if (!sessionHash || !model || !toConnectionId) return null;
      const id = receipt.id || randomUUID();
      db.run(
        `INSERT INTO accountSwitches(id, sessionHash, model, fromConnectionId, toConnectionId,
           trigger, reason, windows, switchedAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          sessionHash,
          model,
          receipt.fromConnectionId ?? null,
          toConnectionId,
          receipt.trigger || 'unknown',
          receipt.reason ?? null,
          receipt.windows == null ? null : JSON.stringify(receipt.windows),
          receipt.switchedAt || receipt.at || nowIso,
        ]
      );
      return { ...receipt, id };
    },
  };
}
