/**
 * Agent-efficient decision log — the emitter.
 *
 * Design: `docs/logging-design.md`. This file is that design's step 1 (the
 * emitter, the schema and the frozen verdict enum) plus the sink half of its
 * step 6. Steps 3-5 wire the decision points; almost nothing calls this yet.
 *
 * One decision, one line:
 *
 *   <iso8601> <CLASS>.<verdict> rid=<8hex> <k=v>...
 *
 * The consumer is `rg`, not a human reading forward, so the console line
 * carries no JSON envelope (about 40% fewer bytes for structure a regex does
 * not need) and no severity level. A non-`REQ` line EXISTING is the severity:
 * the code forked away from nominal. `LOG_LEVEL` is ignored on purpose — the
 * failure being fixed is a signal that got turned down, which already happened
 * here (`logger.js:10` defaults to INFO, so DEBUG has been dark in production).
 *
 * The safety property is structural, not a review habit — the same rule
 * `switchReceipt.js` enforces. This module NEVER spreads, walks or stringifies
 * a caller's object. Every value is coerced to a scalar, passed through the
 * shared `redactSecretsText` chokepoint and truncated, so adding a token or a
 * prompt body to a field bag upstream cannot leak it into a line. A non-scalar
 * renders as the literal `[non-scalar]` and is never inspected.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
// RELATIVE, not 'open-sse/...': this module is also reached from plain-node
// open-sse importers (tokenRefresh/dedup.js), where the bare 'open-sse'
// specifier does not resolve. redact.js imports nothing, so the chain stays
// dependency-free.
import { redactSecretsText } from '../../../open-sse/utils/redact.js';
// RELATIVE, not '@/': open-sse modules (tokenRefresh/dedup.js and friends) emit
// through this file and must stay importable under plain node — the
// open-sse-plain-node-imports test forbids the '@/'' alias on this path, and
// dataDir.js itself imports only node builtins.
import { DATA_DIR } from '../../lib/dataDir.js';

/**
 * The closed verdict vocabulary, one frozen list per class. A verdict that is
 * not in here is a typo, and `assertVerdict` below turns it into a red test
 * rather than a new string in production. Classes are the grep unit:
 * `rg ' CRED\.'` returns every credential decision in the process history.
 *
 * `LOG` is this module's own meta class. The backstop and a dead sink have to
 * be visible, and they must not masquerade as a domain decision.
 */
export const VERDICTS = Object.freeze({
  ADM: Object.freeze(['dispatched', 'queued', 'evicted', 'client-gone', 'ratelimited', 'key-required', 'key-invalid']),
  AUTHZ: Object.freeze(['admit', 'refused', 'mutation-refused']),
  MODEL: Object.freeze(['normalized', 'disabled', 'auto-routed', 'combo-cycle', 'capability-substituted', 'context-overflow']),
  RANK: Object.freeze(['ordered', 'degraded', 'depleted', 'invalid-record', 'shape-mismatch']),
  SEL: Object.freeze(['win', 'pin-hit', 'pin-expired', 'repin', 'skipped', 'operator-pinned', 'refused', 'drain-excluded', 'model-locked', 'quota-paused', 'quota-unknown', 'proxy-unusable']),
  LEASE: Object.freeze(['refused', 'ungated', 'double-release']),
  CRED: Object.freeze(['refresh-failed', 'rotated', 'same', 'chain-diverged', 'dedup-reuse', 'no-refresh-path']),
  LOCK: Object.freeze(['applied', 'permanent', 'monthly-reset', 'clamped']),
  // rtk-applied/headroom-applied/mem-pruned/compact-applied/injected are the
  // token-saver path codes: folded into REQ.ok's path= (and save= carries the
  // measured bytes), so a saver never costs a line on the nominal path.
  XFORM: Object.freeze(['headroom-skip', 'headroom-unavailable', 'headroom-phantom', 'tool-strip', 'cache-keep', 'cache-legacy', 'rtk-applied', 'headroom-applied', 'mem-pruned', 'compact-applied', 'injected', 'saver-guard']),
  UP: Object.freeze(['retry', 'failover', 'attempt-ceiling', 'replay-overflow']),
  STREAM: Object.freeze(['stalled', 'empty', 'non-sse', 'terminal-synthesized', 'usage-estimated', 'detail-pending']),
  ACCT: Object.freeze(['detail-write-failed', 'alias-dropped']),
  DRAIN: Object.freeze(['begin', 'end']),
  REQ: Object.freeze(['ok', 'failed', 'refused']),
  LOG: Object.freeze(['throttled', 'resumed', 'sink-failed', 'unknown-verdict', 'boot']),
});

/** The identity keys, always first and always in this order, so one grep for
 *  `conn=7a1acb09` reads the same across every class. Everything else keeps the
 *  caller's own order, which is how the worked examples read. */
const LEAD_KEYS = Object.freeze(['rid', 'sid', 'conn', 'prov', 'model']);
/** Fold bookkeeping is always last: it is about the line, not about the event. */
const TRAIL_KEYS = Object.freeze(['rep', 'first']);

/** Free text never exceeds this. A provider message longer than a tweet belongs
 *  in the requestDetail row, which already exists and already has a UI. */
const MAX_VALUE_CHARS = 60;

// Folding. Emit on occurrences 1,2,4,8,16,32,64,128 and every 128 after that,
// so 154 identical failures cost 8 lines instead of 154 without losing one.
const FOLD_MAX_KEYS = 512;
const FOLD_ROLLUP_MS = 60 * 60 * 1000;

// Backstop. A fault that forks every request must not be able to turn the log
// into the thing this design exists to delete.
const STORM_WINDOW_MS = 60 * 1000;
const STORM_LIMIT = 200;

const SINK_MAX_BYTES = Number(process.env.TOKENPROXY_LOG_DECISIONS_MAX_BYTES) || 8 * 1024 * 1024;

function enabled() {
  const raw = process.env.TOKENPROXY_LOG_DECISIONS;
  if (raw === undefined) return true;
  const v = String(raw).toLowerCase();
  return !(v === 'off' || v === '0' || v === 'false' || v === 'no');
}

/** Strict where a typo must be loud (tests, and opt-in in dev). In production an
 *  unknown verdict still SPEAKS, as `LOG.unknown-verdict`, because dropping the
 *  line would hide the very event the caller was trying to record. */
function strict() {
  return process.env.TOKENPROXY_LOG_STRICT === '1' || process.env.NODE_ENV === 'test';
}

/**
 * The request id. Design section 3.1: 8 hex characters, minted once per request
 * and carried on every line that request produces.
 *
 * It replaces the eight-emoji correlation namespace at `logger.js:17`, which
 * hashes into 8 buckets and therefore collides above roughly four in-flight
 * requests -- the live journal shows a green DONE landing before the yellow
 * line that started it. The emoji stay for the operator's own reading; `rid` is
 * what actually joins the lines.
 *
 * It lives HERE rather than in `logger.js` because a large part of the suite
 * mocks `logger.js` with a hand-listed export set, so a new export there is a
 * throw at every one of those call sites rather than a new capability.
 *
 * 16 random bits per process, then a 16-bit counter. The counter wraps after
 * 65,536 requests in one process, which at the measured 853 admitted requests
 * per six hours is about 19 days of uptime before one id is reused, and a reuse
 * is harmless because every line is timestamped.
 */
const RID_PREFIX = (() => {
  const b = new Uint8Array(2);
  globalThis.crypto.getRandomValues(b);
  return (((b[0] << 8) | b[1]) >>> 0).toString(16).padStart(4, '0');
})();
let ridCounter = 0;

export function nextRid() {
  ridCounter = (ridCounter + 1) & 0xffff;
  return RID_PREFIX + ridCounter.toString(16).padStart(4, '0');
}

/** The header a front proxy uses to hand its own request id down, so a 503 at
 *  admission is greppable against the gateway lines for the same request. */
export const RID_HEADER = 'x-tp-rid';

/**
 * Adopt an inbound rid, or mint one. The inbound value is UNTRUSTED and reaches
 * a log line, so it is not merely trimmed: anything outside 1-32 hex characters
 * is discarded and a fresh id minted. A header that can carry a space or a
 * newline into a space-delimited k=v line is a log-injection vector, not a
 * formatting nuisance.
 */
export function readRid(request) {
  const raw = request?.headers?.get?.(RID_HEADER);
  if (typeof raw === 'string' && /^[0-9a-fA-F]{1,32}$/.test(raw)) {
    return raw.toLowerCase().slice(0, 8).padStart(8, '0');
  }
  return nextRid();
}

/**
 * One rid per inbound Request, stable for its whole life.
 *
 * The chat path recurses: handleChat -> handleSingleModelChat -> combo members,
 * each hop re-receiving the SAME Request object. Calling readRid at each hop
 * would mint a different id per hop and defeat the whole point, so the id is
 * memoised against the request itself. A WeakMap, so a finished request takes
 * its entry with it.
 */
const ridByRequest = new WeakMap();

export function requestRid(request) {
  if (!request || typeof request !== "object") return nextRid();
  let rid = ridByRequest.get(request);
  if (rid === undefined) {
    rid = readRid(request);
    ridByRequest.set(request, rid);
  }
  return rid;
}

/** 8-char SHA-256 prefix. The way an api key, a session or an IP appears in a
 *  line without the line carrying the thing itself. */
export function idPrefix(value) {
  if (value === null || value === undefined || value === '') return null;
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

/** A relative reset, `+4h12m` / `+38s`, from an absolute epoch ms. An absolute
 *  instant makes a reader do arithmetic; the relative form is the fact. */
export function relativeReset(atMs, nowMs = Date.now()) {
  if (!Number.isFinite(atMs)) return null;
  let s = Math.round((atMs - nowMs) / 1000);
  const sign = s < 0 ? '-' : '+';
  s = Math.abs(s);
  if (s < 60) return `${sign}${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${sign}${h}h${String(m).padStart(2, '0')}m` : `${sign}${m}m`;
}

function hhmmss(ms) {
  return new Date(ms).toISOString().slice(11, 19);
}

function scalar(value) {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') return Number.isFinite(value) ? String(value) : 'nan';
  if (t === 'bigint') return String(value);
  if (t !== 'string') return '[non-scalar]';
  if (value === '') return null;
  const safe = redactSecretsText(value)
    .replace(/[\s\u0000-\u001f\u007f]+/g, '_');
  return safe.length > MAX_VALUE_CHARS ? `${safe.slice(0, MAX_VALUE_CHARS)}…` : safe;
}

function orderedEntries(fields) {
  if (!fields || typeof fields !== 'object') return [];
  const seen = new Set();
  const out = [];
  const push = (k) => {
    if (seen.has(k) || !Object.hasOwn(fields, k)) return;
    seen.add(k);
    const v = scalar(fields[k]);
    if (v !== null) out.push([k, v]);
  };
  for (const k of LEAD_KEYS) push(k);
  for (const k of Object.keys(fields)) if (!TRAIL_KEYS.includes(k)) push(k);
  for (const k of TRAIL_KEYS) push(k);
  return out;
}

/**
 * Build the line without emitting it. Pure, which is what makes the schema
 * testable to the byte.
 */
export function formatLine(cls, verdict, fields, nowMs = Date.now()) {
  const head = `${new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, 'Z')} ${cls}.${verdict}`;
  const tail = orderedEntries(fields).map(([k, v]) => `${k}=${v}`);
  return tail.length ? `${head} ${tail.join(' ')}` : head;
}

function assertVerdict(cls, verdict) {
  if (VERDICTS[cls]?.includes(verdict)) return true;
  if (strict()) {
    throw new Error(`decide(): unknown verdict ${cls}.${verdict}. Add it to VERDICTS in src/shared/observability/decide.js.`);
  }
  return false;
}

// ---------------------------------------------------------------- folding ---

const foldState = new Map();

function shouldEmitAt(n) {
  return n < 128 ? (n & (n - 1)) === 0 : n % 128 === 0;
}

/**
 * Record one occurrence under `key` and say whether this one speaks.
 *
 * The key ALWAYS carries `why`, so a different reason is a different bucket and
 * always emits at occurrence 1. Folding never crosses a change in `why`,
 * because a different reason is a different fact.
 *
 * @returns {{emit: boolean, rep: number, first: number}} `rep` counts the
 *   occurrences this line stands for, including itself.
 */
export function fold(key, nowMs = Date.now()) {
  let st = foldState.get(key);
  if (st) {
    foldState.delete(key); // re-insert = move to the LRU tail
  } else {
    st = { n: 0, lastEmitN: 0, lastEmitAt: 0, firstAt: nowMs };
    if (foldState.size >= FOLD_MAX_KEYS) {
      // Bounded, so the folding state cannot itself become the leak. Evicting
      // costs a rep count, never an event: the next occurrence emits at n=1.
      const lru = foldState.keys().next().value;
      if (lru !== undefined) foldState.delete(lru);
    }
  }
  foldState.set(key, st);
  st.n += 1;
  // `first` is the first occurrence THIS line stands for, which is the first one
  // after the previous emission -- not the previous emission's own instant. A
  // roll-up that misdates the start of the run it is reporting is the same class
  // of quiet lie as the `reset after 1m 53s` on a permanently revoked token.
  if (st.n === st.lastEmitN + 1) st.firstAt = nowMs;
  const hourly = st.lastEmitAt !== 0 && nowMs - st.lastEmitAt >= FOLD_ROLLUP_MS;
  if (!shouldEmitAt(st.n) && !hourly) {
    return { emit: false, rep: st.n - st.lastEmitN, first: st.firstAt };
  }
  const rep = st.n - st.lastEmitN;
  const first = st.firstAt;
  st.lastEmitN = st.n;
  st.lastEmitAt = nowMs;
  return { emit: true, rep, first };
}

/** Fold key: class, verdict, the identity the fault is about, and the reason.
 *  Anything else (a duration, a count) varies per occurrence and would defeat
 *  the fold without adding a fact. */
function foldKey(cls, verdict, fields) {
  const f = fields || {};
  return [cls, verdict, f.conn ?? '', f.model ?? '', f.prov ?? '', f.key ?? '', f.why ?? ''].join('\u0000');
}

// --------------------------------------------------------------- backstop ---

const storm = { windowAt: 0, lines: 0, throttled: false, counts: new Map() };

function stormGate(cls, nowMs) {
  if (cls === 'REQ' || cls === 'LOG') return true;
  if (nowMs - storm.windowAt >= STORM_WINDOW_MS) {
    if (storm.throttled) flushStorm(nowMs);
    storm.windowAt = nowMs;
    storm.lines = 0;
    storm.throttled = false;
    storm.counts.clear();
  }
  if (storm.throttled) {
    storm.counts.set(cls, (storm.counts.get(cls) || 0) + 1);
    return false;
  }
  storm.lines += 1;
  if (storm.lines > STORM_LIMIT) {
    storm.throttled = true;
    storm.counts.set(cls, (storm.counts.get(cls) || 0) + 1);
    write('LOG', 'throttled', { why: 'storm-backstop', window: '60s', limit: STORM_LIMIT }, nowMs);
    return false;
  }
  return true;
}

/** One line per throttled minute naming the classes and their counts. An
 *  unbounded log storm becomes a bounded 2 lines per minute, and the counters
 *  are still an answer. */
function flushStorm(nowMs) {
  const classes = [...storm.counts.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join(',');
  const dropped = [...storm.counts.values()].reduce((a, b) => a + b, 0);
  write('LOG', 'resumed', { why: 'storm-backstop-window-closed', dropped, classes }, nowMs);
}

// ------------------------------------------------------------------ sinks ---

let sinkPath = null;
let sinkDead = false;

function sinkFile() {
  if (sinkPath) return sinkPath;
  sinkPath = path.join(DATA_DIR, 'logs', 'decisions.ndjson');
  return sinkPath;
}

/** Size-capped with one generation of rollover. A log that can fill a disk is a
 *  worse outage than the one it was written to diagnose. */
function appendNdjson(record) {
  if (sinkDead) return;
  try {
    const file = sinkFile();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const size = fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0;
    if (size >= SINK_MAX_BYTES) fs.renameSync(file, `${file}.1`);
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  } catch (e) {
    // Fail soft and say so once. A decision log that can throw into a request
    // path has traded the fault it was recording for one of its own.
    sinkDead = true;
    console.log(formatLine('LOG', 'sink-failed', { why: 'ndjson-append-threw', err: e?.code || e?.message }));
  }
}

function write(cls, verdict, fields, nowMs) {
  const entries = orderedEntries(fields);
  const line = formatLine(cls, verdict, fields, nowMs);
  // console.log, not process.stdout: consoleLogBuffer.js:86 tees console output
  // into the dashboard ring buffer, so the decision lines stay visible in the UI
  // that already exists rather than becoming journald-only.
  console.log(line);
  appendNdjson({ ts: new Date(nowMs).toISOString(), cls, verdict, ...Object.fromEntries(entries) });
  return line;
}

// ------------------------------------------------------------------- API ----

/**
 * Emit one decision line, folded.
 *
 * @param {string} cls one of `VERDICTS`' keys
 * @param {string} verdict a member of that class's frozen list
 * @param {object} [fields] scalars only; objects render as `[non-scalar]`
 * @returns {string|null} the line emitted, or null when folded or disabled
 */
export function decide(cls, verdict, fields = {}, nowMs = Date.now()) {
  if (!enabled()) return null;
  const known = assertVerdict(cls, verdict);
  if (!known) return write('LOG', 'unknown-verdict', { why: `${cls}.${verdict}`, ...fields }, nowMs);
  if (!stormGate(cls, nowMs)) return null;
  const { emit, rep, first } = fold(foldKey(cls, verdict, fields), nowMs);
  if (!emit) return null;
  // rep=1 is a single event and needs no bookkeeping; anything above it names
  // how many occurrences this line stands for and when the run started.
  const withFold = rep > 1 ? { ...fields, rep, first: hhmmss(first) } : fields;
  return write(cls, verdict, withFold, nowMs);
}

/**
 * The one nominal line: a whole successful request in a single record. Never
 * folded (one per request already) and never throttled by the backstop, which
 * counts only the non-nominal classes.
 */
export function req(verdict, fields = {}, nowMs = Date.now()) {
  if (!enabled()) return null;
  if (!assertVerdict('REQ', verdict)) return write('LOG', 'unknown-verdict', { why: `REQ.${verdict}`, ...fields }, nowMs);
  return write('REQ', verdict, fields, nowMs);
}

// ------------------------------------------------------------- path folding ---
//
// The mechanism that keeps the nominal path silent without losing it. Every
// fold-eligible fork appends its `CLASS.verdict` code to a per-request list
// instead of emitting a line; the REQ summary prints the list as `path=`. A
// request whose path is empty took every default.
//
// Bound three ways so the collector cannot become the leak: codes cap at 12
// per request (the doc's hard ceiling is one line per class), entries expire
// 10 minutes after their last append (a request that never reaches REQ leaves
// no state behind), and the map itself sweeps at 4096 entries.

const PATH_MAX_CODES = 12;
const PATH_ENTRY_TTL_MS = 10 * 60 * 1000;
const PATH_MAP_SWEEP_AT = 4096;

const paths = new Map();

function sweepPaths(nowMs) {
  if (paths.size < PATH_MAP_SWEEP_AT) return;
  for (const [rid, entry] of paths) {
    if (nowMs - entry.at > PATH_ENTRY_TTL_MS) paths.delete(rid);
  }
}

/** Record one folded fork for a request: notePath(rid, 'XFORM.headroom-skip'). */
export function notePath(rid, code, nowMs = Date.now()) {
  if (typeof rid !== 'string' || rid === '' || typeof code !== 'string' || code === '') return;
  sweepPaths(nowMs);
  let entry = paths.get(rid);
  if (!entry) {
    entry = { codes: [], at: nowMs };
    paths.set(rid, entry);
  }
  entry.at = nowMs;
  if (entry.codes.length < PATH_MAX_CODES && !entry.codes.includes(code)) {
    entry.codes.push(code);
  }
}

/** The folded codes for a request, without clearing. Test and summary seam. */
export function pathFor(rid) {
  const entry = paths.get(rid);
  return entry ? [...entry.codes] : [];
}

function takePath(rid, nowMs = Date.now()) {
  const entry = paths.get(rid);
  if (!entry) return null;
  paths.delete(rid);
  // The list is dropped from the TAIL to fit, not truncated mid-string: the
  // earliest forks are the ones a reader needs first. Path codes are
  // machine-generated CLASS.verdict tokens (no free text, no leak channel),
  // so the render budget is wider than the free-text value cap — five saver
  // codes plus cache-keep/legacy must survive to make save=/path= auditable.
  const PATH_RENDER_MAX = 120;
  let codes = entry.codes;
  const render = (list) => list.join(',');
  while (codes.length > 1 && render(codes).length > PATH_RENDER_MAX) {
    codes = codes.slice(0, -1);
  }
  const joined = render(codes);
  return joined.length > PATH_RENDER_MAX ? null : joined;
}

/**
 * The one nominal line: a whole successful request in a single record. Never
 * folded (one per request already) and never throttled by the backstop, which
 * counts only the non-nominal classes. Carries `path=` when the request took
 * non-default forks that folded instead of speaking.
 */
export function reqSummary(verdict, fields = {}, nowMs = Date.now()) {
  const rid = typeof fields?.rid === 'string' ? fields.rid : null;
  if (rid) {
    const path = takePath(rid, nowMs);
    if (path) fields = { ...fields, path };
  }
  return req(verdict, fields, nowMs);
}

// Test seam: folding and the backstop are process-wide singletons, so a suite
// needs a way to start from empty without reaching into the maps.
export const __decide = {
  resetState() {
    foldState.clear();
    paths.clear();
    storm.windowAt = 0;
    storm.lines = 0;
    storm.throttled = false;
    storm.counts.clear();
    sinkDead = false;
  },
  foldSize: () => foldState.size,
  pathSize: () => paths.size,
  disableSink() { sinkDead = true; },
  FOLD_MAX_KEYS,
  STORM_LIMIT,
};
