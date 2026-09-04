/**
 * Compound quota-window ranking — the native replacement for static priority
 * and round-robin account selection (RECONCILIATION.md, Account Scheduling
 * Contract rules 1-3; docs/reconciliation/overlay-spec.md §1).
 *
 * Pure. No DB imports, no provider imports, no wall-clock reads: the caller
 * injects `now`, so a ranking test is deterministic and a ranking decision is
 * reproducible from its recorded inputs. This is a NEW concern beside
 * quotaPause.js, which stays a fail-open per-window pause check and is not
 * touched by anything here.
 *
 * The invariant, in one line: burn the entitlement that is about to be wasted
 * first, and never let a short window's reset order override a longer window
 * that is actually binding. Configured priority breaks ties only.
 *
 * Window records use the contract's normalized shape, which is also the
 * `quotaWindows` table shape in src/lib/db/schema.js:
 *   { scope, remaining, limit, resetAt, observedAt, confidence }
 * `remaining` and `limit` are absolute units. A percentage cannot compare
 * headroom across a 5h window of 300 units and a 30d window of 90,000.
 */

// Horizon in milliseconds, keyed by the parenthetical duration a provider
// appends to a window name ("session (5h)", "weekly (7d)", "monthly (30d)").
// Values follow overlay-spec §1 exactly.
const UNIT_MS = {
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  mo: 2_592_000_000,
  month: 2_592_000_000,
  y: 31_536_000_000,
  year: 31_536_000_000,
};

// Fallback horizon by bare window name when no parenthetical is present.
const BARE_NAME_MS = {
  hourly: 3_600_000,
  daily: 86_400_000,
  weekly: 604_800_000,
  monthly: 2_592_000_000,
  annual: 31_536_000_000,
  yearly: 31_536_000_000,
};

// A scope naming a specific model or feature is a sub-quota, not whole-account
// entitlement. It is tolerated and ignored for ranking (§1 window
// classification) rather than failing the account.
const SCOPED_MARKERS = /\b(per[-_ ]?model|per[-_ ]?feature|model|feature|tool|agent)\b/i;

const GENERAL_NAMES = /\b(session|rate[-_ ]?limit|hourly|daily|weekly|monthly|annual|yearly)\b/i;

/**
 * Horizon of a window in milliseconds. A parenthetical duration wins over the
 * bare name so `session (5h)` is 5h and not the 1 ms unknown fallback.
 * Unknown shapes get 1 ms, which sorts them last among general windows without
 * discarding them.
 */
export function windowHorizonMs(scope) {
  const name = String(scope ?? '');
  const paren = /\(\s*(\d+(?:\.\d+)?)\s*([a-z]+)\s*\)/i.exec(name);
  if (paren) {
    const unit = UNIT_MS[paren[2].toLowerCase()];
    if (unit) return Number(paren[1]) * unit;
  }
  const bare = GENERAL_NAMES.exec(name);
  if (bare) {
    const ms = BARE_NAME_MS[bare[1].toLowerCase().replace(/[-_ ]/g, '')];
    if (ms) return ms;
  }
  return 1;
}

/**
 * GENERAL (whole-account entitlement, ranked) vs SCOPED (sub-quota, ignored)
 * vs null (neither vocabulary — fails this one account closed, never the
 * provider).
 */
export function classifyWindow(scope) {
  const name = String(scope ?? '').trim();
  if (!name) return null;
  if (SCOPED_MARKERS.test(name) && !GENERAL_NAMES.test(name)) return 'scoped';
  if (GENERAL_NAMES.test(name)) return 'general';
  if (/\(\s*\d+(?:\.\d+)?\s*[a-z]+\s*\)/i.test(name)) return 'general';
  return null;
}

function parseResetAt(value) {
  // Strict per overlay-spec §1's stated conflict resolution: a general window
  // with no parseable reset evidence is NOT usable entitlement. An account
  // earns its rank from evidence, never from an evidence gap.
  if (typeof value !== 'string' || value.trim() === '') return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function finiteNonNegative(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Normalize one account's raw windows into ranked general windows.
 * Returns { ok: false, reason } when the account falls out of ranking; the
 * caller keeps it as failover inventory rather than deleting it (§10).
 */
export function normalizeAccountWindows(windows) {
  if (!Array.isArray(windows) || windows.length === 0) {
    return { ok: false, reason: 'no-windows' };
  }
  const general = [];
  for (const w of windows) {
    if (!w || typeof w !== 'object') return { ok: false, reason: 'malformed-window' };
    const kind = classifyWindow(w.scope);
    if (kind === null) return { ok: false, reason: `unclassifiable-scope:${w.scope}` };
    if (kind === 'scoped') continue;

    const remaining = finiteNonNegative(w.remaining);
    if (remaining === null) return { ok: false, reason: `bad-remaining:${w.scope}` };
    const limit = finiteNonNegative(w.limit);
    if (limit === null || limit <= 0) return { ok: false, reason: `bad-limit:${w.scope}` };
    const resetAt = parseResetAt(w.resetAt);
    if (resetAt === null) return { ok: false, reason: `bad-resetAt:${w.scope}` };

    general.push({
      scope: String(w.scope),
      horizonMs: windowHorizonMs(w.scope),
      remaining,
      limit,
      resetAt,
      observedAt: parseResetAt(w.observedAt),
      confidence: typeof w.confidence === 'string' ? w.confidence : 'unknown',
    });
  }
  if (general.length === 0) return { ok: false, reason: 'no-general-windows' };

  // Longest horizon first. The array of resetAt values in this order is the
  // ranking key: the longest window is compared first, so a constraining 30d
  // window can never be overridden by a 5h window's sooner reset.
  general.sort((a, b) => b.horizonMs - a.horizonMs || a.scope.localeCompare(b.scope));
  return { ok: true, windows: general };
}

// Eligibility, Scheduling Contract rule 2: every KNOWN hard window must have
// headroom. A window at or past its limit is a hard stop for the account.
//
// `nowMs` is load-bearing, not decoration. A window whose resetAt has already
// elapsed has replenished, so the depleted reading is stale evidence about a
// window that no longer exists. Without this, an account that just reset stays
// permanently ineligible until someone re-fetches usage, and rule 5's
// "atomically return to the earliest restored account" can never fire.
// The spec's predicate is `used < total`. In the normalized absolute-unit shape
// that is exactly `remaining > 0`, since used == limit - remaining. Adding a
// `remaining < limit` clause translates the OTHER side of the comparison too
// and silently encodes `used > 0`, which makes a never-touched account with
// full headroom permanently ineligible — the single most usable account there
// is. Keep the predicate on one operand.
function isUsable(general, nowMs) {
  return general.every((w) => w.resetAt <= nowMs || w.remaining > 0);
}

// Rule 2: unknown evidence must not outrank fresh known evidence, but it must
// not take the account offline either. Confidence is a BAND applied at ordering
// key 1; inside a band overlay-spec §1's five keys apply unchanged.
const CONFIDENCE_BAND = { fresh: 0, stale: 1, unknown: 2 };
const BAND_NAME = ['fresh', 'stale', 'unknown'];
function bandOf(general) {
  return general.reduce((worst, w) => Math.max(worst, CONFIDENCE_BAND[w.confidence] ?? 2), 0);
}

// ---------------------------------------------------------------------------
// Decision trace. rankAccounts stays pure: it RETURNS {cls, verdict, fields}
// entries (docs/logging-design.md rows 18-24) and never imports
// observability/decide.js. auth.js walks the trace and prints it.
// ---------------------------------------------------------------------------

// Evidence age, folded into alt tokens as a short duration (30m, 2h, 3d).
function ageToken(observedAts, nowMs) {
  const finite = observedAts.filter(Number.isFinite);
  if (!finite.length || !Number.isFinite(nowMs)) return null;
  const mins = Math.max(0, Math.round((nowMs - Math.max(...finite)) / 60_000));
  if (mins <= 0) return null;
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

const soonestResetOf = (windows) => {
  const resets = (windows || []).map((w) => w.resetAt).filter(Number.isFinite);
  return resets.length ? new Date(Math.min(...resets)).toISOString() : null;
};

const minRemainingOf = (windows) => {
  const rems = (windows || []).map((w) => w.remaining).filter(Number.isFinite);
  return rems.length ? Math.min(...rems) : null;
};

// Shape fingerprint for the cohort gate (§1): comparing accounts whose window
// sets differ is worse than not ranking them at all.
function shapeKey(general) {
  return general.map((w) => `${w.horizonMs}:${w.scope}`).join('|');
}

function priorityOf(account) {
  const p = Number(account?.priority);
  return Number.isFinite(p) ? p : Number.POSITIVE_INFINITY;
}

/**
 * Rank accounts for one provider node.
 *
 * @param {Array<{id: string, priority?: number, windows: Array<object>}>} accounts
 * @param {{now: number|Date, previousPinId?: string|null}} options
 *   `now` is REQUIRED and injected — this module never reads the clock.
 * @returns {{
 *   ranked: Array<object>, eligible: Array<object>, ineligible: Array<object>,
 *   winner: object|null, degraded: boolean, reason: string|null
 * }}
 *   `degraded` true means the cohort gate refused to rank and the result is the
 *   previous-pin-first fallback in original order. Every account is present in
 *   `ranked` either way, because a non-winning account stays failover
 *   inventory (§10) rather than being deactivated.
 */
export function rankAccounts(accounts, { now, previousPinId = null } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) {
    throw new TypeError('rankAccounts requires an injected numeric or Date `now`');
  }
  const list = Array.isArray(accounts) ? accounts : [];

  const records = list.map((account, index) => {
    const norm = normalizeAccountWindows(account?.windows);
    return {
      id: account?.id,
      account,
      index,
      priority: priorityOf(account),
      windows: norm.ok ? norm.windows : [],
      valid: norm.ok,
      reason: norm.ok ? null : norm.reason,
      usable: norm.ok ? isUsable(norm.windows, nowMs) : false,
      band: norm.ok ? bandOf(norm.windows) : CONFIDENCE_BAND.unknown,
    };
  });

  // A single-member cohort short-circuits: there is nothing to compare it
  // against, so its own validity decides eligibility and no ranking runs.
  //
  // An INVALID solo record degrades rather than reporting a clean empty
  // eligible set, which is the same failure direction the cohort gate below
  // takes for the identical evidence. Without this the arity decided the
  // outcome: two accounts with no quota evidence degrade to previous-pin-first
  // and both stay routable, while ONE account with no quota evidence returned
  // `degraded: false` with nothing eligible, which a caller reads as "ranking
  // ran and this account is not usable" and refuses the request. A provider
  // that reports no usage at all (most of them) on a single-account install
  // therefore served nothing. Refusing to rank is not evidence of
  // unusability, whether the cohort holds one member or ten.
  // Trace helpers, built from the same records the decision runs on. Every
  // token is an id prefix, an enum, or a short duration, so a printed line
  // stays inside the design's value contract without any work here.
  const id8 = (v) => String(v ?? '').slice(0, 8);
  const altToken = (r) => {
    const band = BAND_NAME[r.band] ?? 'unknown';
    const age = ageToken((r.windows || []).map((w) => w.observedAt), nowMs);
    return `${id8(r.id)}:${band}${age ? `:${age}` : ''}`;
  };
  // The first sort key on which two records differ — the name of the ordering
  // key that actually decided between them (mirrors the comparator below).
  const decidedKey = (a, b) => {
    if (a.usable !== b.usable || a.band !== b.band) return 'evidence-band';
    const n = Math.min(a.windows.length, b.windows.length);
    for (let i = 0; i < n; i += 1) if (a.windows[i].resetAt !== b.windows[i].resetAt) return 'reset-horizon';
    if ((a.id === previousPinId) !== (b.id === previousPinId)) return 'pinned-continuity';
    if (a.priority !== b.priority) return 'configured-priority';
    return 'fallback-order';
  };
  const winTrace = (winner, ranked) => {
    const fields = {
      conn: id8(winner.id),
      key: ranked.find((r) => r.usable && r.id !== winner.id) ? decidedKey(winner, ranked.find((r) => r.usable && r.id !== winner.id)) : 'fallback-order',
      win: true,
      alt: ranked.filter((r) => r.valid && r.id !== winner.id).slice(0, 3).map(altToken),
    };
    const rem = minRemainingOf(winner.windows);
    if (rem !== null) fields.rem = rem;
    const reset = soonestResetOf(winner.windows);
    if (reset) fields.reset = reset;
    return { cls: 'SEL', verdict: 'win', fields };
  };

  if (records.length <= 1) {
    const only = records[0] || null;
    if (only && !only.valid) {
      return {
        ranked: records,
        eligible: [],
        ineligible: records,
        winner: null,
        degraded: true,
        reason: `invalid-record:${only.id}:${only.reason}`,
        trace: [{ cls: 'RANK', verdict: 'invalid-record', fields: { conn: id8(only.id), why: only.reason } }],
      };
    }
    if (!only) {
      return {
        ranked: records,
        eligible: [],
        ineligible: [],
        winner: null,
        degraded: false,
        reason: 'empty-cohort',
        trace: [{ cls: 'RANK', verdict: 'degraded', fields: { win: false, why: 'empty-cohort' } }],
      };
    }
    if (!only.usable) {
      return {
        ranked: records,
        eligible: [],
        ineligible: [only],
        winner: null,
        degraded: false,
        reason: null,
        trace: [{
          cls: 'RANK',
          verdict: 'depleted',
          fields: { win: false, alt: [altToken(only)], reset: soonestResetOf(only.windows) },
        }],
      };
    }
    return {
      ranked: records,
      eligible: [only],
      ineligible: [],
      winner: only,
      degraded: false,
      reason: null,
      trace: [winTrace(only, records)],
    };
  }

  const fallback = () => {
    const ordered = [...records].sort((a, b) => {
      const ap = a.id === previousPinId ? 0 : 1;
      const bp = b.id === previousPinId ? 0 : 1;
      return ap - bp || a.index - b.index;
    });
    return ordered;
  };

  // Cohort gate: every record valid, one shared window shape, at least one
  // usable. Any miss degrades the whole group to previous-pin stickiness
  // rather than aborting the request (§1 failure direction).
  const invalid = records.find((r) => !r.valid);
  if (invalid) {
    return {
      ranked: fallback(),
      eligible: [],
      ineligible: records.filter((r) => !r.valid || !r.usable),
      winner: null,
      degraded: true,
      reason: `invalid-record:${invalid.id}:${invalid.reason}`,
      trace: [{ cls: 'RANK', verdict: 'invalid-record', fields: { win: false, conn: id8(invalid.id), why: invalid.reason } }],
    };
  }
  const shapes = new Set(records.map((r) => shapeKey(r.windows)));
  if (shapes.size > 1) {
    const a = records[0];
    const b = records.find((r) => shapeKey(r.windows) !== shapeKey(a.windows));
    return {
      ranked: fallback(),
      eligible: [],
      ineligible: [],
      winner: null,
      degraded: true,
      reason: 'cohort-shape-mismatch',
      trace: [{
        cls: 'RANK',
        verdict: 'shape-mismatch',
        fields: { win: false, conn: id8(a.id), a: shapeKey(a.windows), b: shapeKey(b.windows) },
      }],
    };
  }
  if (!records.some((r) => r.usable)) {
    return {
      ranked: fallback(),
      eligible: [],
      ineligible: [...records],
      winner: null,
      degraded: true,
      reason: 'cohort-all-depleted',
      trace: [{
        cls: 'RANK',
        verdict: 'depleted',
        fields: { win: false, alt: records.map(altToken), reset: soonestResetOf(records.flatMap((r) => r.windows)) },
      }],
    };
  }

  // Five ordering keys, in order (§1):
  //   0. usable before depleted, then confidence band (rule 2: unknown never
  //      outranks fresh known evidence, but never goes offline either)
  //   2. resetAt array, longest horizon first, compared element by element —
  //      the account whose LONGEST window resets soonest wins, so entitlement
  //      about to be wasted is spent first
  //   3. previous pin (stickiness; never round-robin)
  //   4. configured priority, lowest wins, missing = unbounded — TIE-BREAK ONLY
  //   5. original index, so the sort is total and therefore deterministic
  const ranked = [...records].sort((a, b) => {
    if (a.usable !== b.usable) return a.usable ? -1 : 1;
    if (a.band !== b.band) return a.band - b.band;

    const n = Math.min(a.windows.length, b.windows.length);
    for (let i = 0; i < n; i += 1) {
      const d = a.windows[i].resetAt - b.windows[i].resetAt;
      if (d !== 0) return d;
    }
    if (a.windows.length !== b.windows.length) return a.windows.length - b.windows.length;

    const ap = a.id === previousPinId ? 0 : 1;
    const bp = b.id === previousPinId ? 0 : 1;
    if (ap !== bp) return ap - bp;

    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.index - b.index;
  });

  const eligible = ranked.filter((r) => r.usable);
  const winner = eligible[0] || null;
  return {
    ranked,
    eligible,
    ineligible: ranked.filter((r) => !r.usable),
    winner,
    degraded: false,
    reason: null,
    trace: winner ? [winTrace(winner, ranked)] : [],
  };
}

/**
 * Convenience wrapper: the winning account id, or null when the cohort
 * degraded or nothing is eligible. Callers that need the reason or the
 * failover inventory use rankAccounts directly.
 */
export function selectAccount(accounts, options) {
  return rankAccounts(accounts, options).winner?.id ?? null;
}
