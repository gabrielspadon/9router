import { randomUUID } from 'node:crypto';
import { getAdapter } from '../driver.js';
import { parseJson, stringifyJson } from '../helpers/jsonCol.js';

// Switch receipts (Account Scheduling Contract rule 8): why a session left one
// account for another, kept after the quota windows the decision rested on have
// moved on. Append-only — a receipt is evidence about a moment, so amending one
// would falsify the record it exists to be.
//
// What rule 8 requires: old and new connection ids, the normalized quota
// windows, the trigger, the model, the session hash, and a timestamp. What it
// forbids, and what therefore has no column and never reaches this module: any
// credential, and any prompt body.

export async function recordSwitch(receipt) {
  if (!receipt || typeof receipt !== 'object') return null;
  const { sessionHash, model, toConnectionId } = receipt;
  // The three fields with no defensible default. A receipt missing any of them
  // cannot answer "which session, on which model, went where", which is the
  // only question it is stored to answer.
  if (!sessionHash || !model || !toConnectionId) return null;

  const row = {
    id: receipt.id || randomUUID(),
    sessionHash,
    model,
    fromConnectionId: receipt.fromConnectionId ?? null,
    toConnectionId,
    trigger: receipt.trigger || 'unknown',
    reason: receipt.reason ?? null,
    // The evidence, verbatim as the ranker saw it. Serialized rather than
    // normalized into columns because the window SET differs per provider, and
    // a fixed column layout would silently drop whichever window a provider
    // reports that the layout did not anticipate.
    windows: receipt.windows == null ? null : stringifyJson(receipt.windows),
    switchedAt: receipt.switchedAt || new Date().toISOString(),
  };

  const db = await getAdapter();
  db.run(
    `INSERT INTO accountSwitches(id, sessionHash, model, fromConnectionId, toConnectionId,
       trigger, reason, windows, switchedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.sessionHash,
      row.model,
      row.fromConnectionId,
      row.toConnectionId,
      row.trigger,
      row.reason,
      row.windows,
      row.switchedAt,
    ]
  );
  return { ...row, windows: receipt.windows ?? null };
}

// Newest first, because every question asked of this log ("why is this session
// on that account") is about the most recent switches.
export async function listSwitches({ sessionHash, connectionId, limit = 50 } = {}) {
  const conds = [];
  const params = [];
  if (sessionHash) {
    conds.push('sessionHash = ?');
    params.push(sessionHash);
  }
  // Either side of the move: a drain audit asks what left an account, a repin
  // audit asks what arrived.
  if (connectionId) {
    conds.push('(fromConnectionId = ? OR toConnectionId = ?)');
    params.push(connectionId, connectionId);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const cap = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 50;

  const db = await getAdapter();
  const rows = db.all(
    `SELECT id, sessionHash, model, fromConnectionId, toConnectionId, trigger, reason, windows, switchedAt
     FROM accountSwitches ${where} ORDER BY switchedAt DESC LIMIT ?`,
    [...params, cap]
  );
  return rows.map((r) => ({
    id: r.id,
    sessionHash: r.sessionHash,
    model: r.model,
    fromConnectionId: r.fromConnectionId ?? null,
    toConnectionId: r.toConnectionId,
    trigger: r.trigger,
    reason: r.reason ?? null,
    windows: parseJson(r.windows, null),
    switchedAt: r.switchedAt,
  }));
}
