#!/usr/bin/env node
/**
 * G6: 80 concurrent isolated requests complete or wait with no local admission
 * 503, no starvation, and no leaked lease.
 *
 * A plain node script, not a vitest case: the point is to drive the REAL
 * selectAndReserve and the REAL lease registry in-process at full width, on
 * per-connection capacities small enough that queuing is forced. A run that
 * merely proved 80 promises settled would prove nothing about admission.
 *
 * Four properties are checked, and `PARALLELISM_OK 80` prints only when all
 * four hold:
 *   1. zero local admission refusals — every session completed or waited
 *   2. no starvation — every session got service, and the worst-case wait
 *      DISPLACEMENT is bounded by the total slot count, not merely a total
 *   3. zero leaked leases — inFlight returns to 0 for every connection
 *   4. no monopolization — the per-session service distribution is asserted,
 *      not eyeballed, and no connection ever exceeded its own capacity
 *
 * On any failure it names the specific violation and exits non-zero. Nothing
 * here reads the wall clock: `now` is injected, as it is everywhere else in
 * this subsystem.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), '../..');
const srcUrl = pathToFileURL(repoRoot + '/src/').href;

// The modules under test import "@/...", which is a bundler alias. A bare
// `node` run needs it resolved, and a resolution hook is the smallest thing
// that keeps this script exercising the SHIPPING modules rather than a
// reimplementation of them, which would prove nothing about the code that runs.
register(
  'data:text/javascript,' +
    encodeURIComponent(`
      export function resolve(specifier, context, nextResolve) {
        if (specifier.startsWith("@/")) {
          return nextResolve(new URL(specifier.slice(2), ${JSON.stringify(srcUrl)}).href, context);
        }
        return nextResolve(specifier, context);
      }
    `),
  import.meta.url
);

// Dynamic, because a static import is hoisted above the register() call.
const { createLeaseRegistry } = await import('@/shared/utils/accountLease.js');
const { effectiveCapacity } = await import('@/shared/utils/accountCapacity.js');
const { selectAndReserve } = await import('@/sse/services/accountScheduler.js');

const SESSIONS = 80;
const TURNS = 3; // each session makes several requests, so a distribution exists to assert
const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

const w = (scope, remaining, limit, resetAt) => ({
  scope,
  remaining,
  limit,
  resetAt,
  observedAt: iso(0),
  confidence: 'fresh',
});

// Deliberately unequal per-connection capacities (rule 7), summing to 14 —
// far under 80, so the run is dominated by WAITING, which is the condition the
// gate is about. Every window has real headroom: `remaining: 0` is how this
// suite spells depleted, and nothing here is depleted.
const ACCOUNTS = [
  { id: 'acct-a', maxConcurrent: 3 },
  { id: 'acct-b', maxConcurrent: 5 },
  { id: 'acct-c', maxConcurrent: 2 },
  { id: 'acct-d', maxConcurrent: 4 },
].map((a) => ({
  ...a,
  windows: [w('session (5h)', 4000, 5000, iso(HOUR)), w('weekly (7d)', 90000, 100000, iso(6 * DAY))],
}));

const TOTAL_SLOTS = ACCOUNTS.reduce((n, a) => n + a.maxConcurrent, 0);

const registry = createLeaseRegistry({
  capacityOf: (id) => effectiveCapacity(ACCOUNTS.find((a) => a.id === id) ?? null).limit,
});

// In-memory repos. No DB barrel import: this script exercises scheduling, and
// a scheduler that needs a database to be tested is a scheduler with a hidden
// dependency.
const pins = new Map();
const switches = [];
const repos = {
  transaction: (fn) => fn(),
  getPin: ({ sessionHash, model }) => pins.get(`${sessionHash} ${model}`) ?? null,
  setPin: ({ sessionHash, model, connectionId, at }) =>
    pins.set(`${sessionHash} ${model}`, { connectionId, at }),
  recordSwitch: (r) => switches.push(r),
};

// ── instrumentation ─────────────────────────────────────────────────────────
const violations = [];
let refusals = 0; // a caller that got a local 503 instead of a slot
const servedBySession = new Map(); // sessionHash -> admissions
const servedByConnection = new Map();
const peakByConnection = new Map();

// Wait-ordering instrumentation. Every admission REQUEST takes a ticket when it
// asks for a slot; every admission records the ticket it was holding. Measuring
// tickets rather than sessions means all 240 requests are covered, not just the
// 80 that happen to arrive in a batch at t=0.
let ticketSeq = 0;
const admittedTickets = []; // ticket numbers, in the order slots were granted

// ── FIFO admission queue ────────────────────────────────────────────────────
// A waiter never jumps the head of the queue: `pump` stops at the first waiter
// that cannot be admitted rather than scanning past it for one that can. That
// is what makes the displacement bound below meaningful — a "best fit" pump
// starves whoever is unlucky in ranked order.
const queue = [];

function attempt(sessionHash) {
  return selectAndReserve({
    sessionHash,
    model: 'test-model',
    accounts: ACCOUNTS,
    windows: {},
    now: NOW,
    registry,
    repos,
  });
}

function admit(sessionHash) {
  const ticket = ticketSeq++;
  const res = attempt(sessionHash);
  if (res.lease) {
    admittedTickets.push(ticket);
    return Promise.resolve(res);
  }
  if (!res.unavailable) {
    violations.push(`selectAndReserve returned neither a lease nor unavailable for ${sessionHash}`);
    return Promise.resolve(res);
  }
  if (res.reason !== 'at-capacity') {
    // Anything other than "wait, the slots are all busy" is a local refusal —
    // exactly the 503 this gate forbids.
    refusals += 1;
    violations.push(`local admission refusal for ${sessionHash}: ${res.reason}`);
  }
  return new Promise((resolve) => queue.push({ sessionHash, ticket, resolve }));
}

function pump() {
  while (queue.length > 0) {
    const head = queue[0];
    const res = attempt(head.sessionHash);
    if (!res.lease) return; // still full — strict FIFO, no skipping ahead
    queue.shift();
    admittedTickets.push(head.ticket);
    head.resolve(res);
  }
}

function record(sessionHash, connectionId) {
  servedBySession.set(sessionHash, (servedBySession.get(sessionHash) ?? 0) + 1);
  servedByConnection.set(connectionId, (servedByConnection.get(connectionId) ?? 0) + 1);
  const live = registry.inFlight(connectionId);
  peakByConnection.set(connectionId, Math.max(peakByConnection.get(connectionId) ?? 0, live));
}

const tick = () => new Promise((r) => setImmediate(r));

async function runSession(sessionHash) {
  for (let turn = 0; turn < TURNS; turn += 1) {
    const res = await admit(sessionHash);
    if (!res.lease) {
      violations.push(`${sessionHash} turn ${turn} never received a lease`);
      return;
    }
    try {
      record(sessionHash, res.lease.connectionId);
      // Simulated service time. Macrotask turns, not a real sleep: the run has
      // to be dominated by contention, not by waiting on a timer.
      await tick();
      await tick();
    } finally {
      // The release path every caller uses: a `finally` plus an idempotent
      // release. A leaked lease here is the failure this gate is looking for.
      registry.release(res.lease);
      pump();
    }
  }
}

// ── run ─────────────────────────────────────────────────────────────────────
const sessions = Array.from(
  { length: SESSIONS },
  (_, i) => `sha256:sess-${String(i).padStart(3, '0')}`
);

const settled = await Promise.allSettled(sessions.map(runSession));
for (const [i, s] of settled.entries()) {
  if (s.status === 'rejected') violations.push(`session ${i} rejected: ${s.reason}`);
}

// ── proof 1: zero local admission refusals ──────────────────────────────────
if (refusals !== 0) violations.push(`local admission refusals: ${refusals} (must be 0)`);
if (queue.length !== 0) violations.push(`${queue.length} waiters never admitted — the queue stalled`);

// ── proof 2: no starvation, with a bound on worst-case wait ordering ────────
const served = [...servedBySession.keys()];
if (served.length !== SESSIONS) {
  violations.push(`only ${served.length}/${SESSIONS} sessions got any service at all`);
}
if (admittedTickets.length !== SESSIONS * TURNS) {
  violations.push(
    `admissions recorded ${admittedTickets.length}, expected ${SESSIONS * TURNS}`
  );
}
// Overtakes, over EVERY admission and not just the opening batch. A request
// that took ticket T is overtaken by any later ticket admitted before it. Under
// strict FIFO the only requests that may legitimately jump ahead are the ones
// already holding a slot when T asked, so the bound is the total slot count.
// This is the assertion that fails if `pump` ever scans past a blocked head to
// find a servable waiter: that policy leaves the unlucky ticket behind
// indefinitely while every session still eventually completes.
let maxOvertakes = 0;
let worstTicket = null;
const admittedByTicket = new Map(admittedTickets.map((t, order) => [t, order]));
for (const [ticket, order] of admittedByTicket) {
  // How many tickets issued AFTER this one were granted BEFORE it.
  let overtakes = 0;
  for (let i = 0; i < order; i += 1) if (admittedTickets[i] > ticket) overtakes += 1;
  if (overtakes > maxOvertakes) {
    maxOvertakes = overtakes;
    worstTicket = ticket;
  }
}
if (maxOvertakes > TOTAL_SLOTS) {
  violations.push(
    `starvation: ticket ${worstTicket} overtaken ${maxOvertakes} times, FIFO bound is ${TOTAL_SLOTS}`
  );
}

// ── proof 3: zero leaked leases ─────────────────────────────────────────────
const leaked = registry.snapshot();
if (registry.inFlight() !== 0 || Object.keys(leaked).length !== 0) {
  violations.push(`leaked leases: ${JSON.stringify(leaked)} (inFlight ${registry.inFlight()})`);
}
for (const account of ACCOUNTS) {
  if (registry.inFlight(account.id) !== 0) {
    violations.push(`${account.id} still holds ${registry.inFlight(account.id)} leases`);
  }
}

// ── proof 4: no monopolization, and no over-admission ───────────────────────
const counts = served.map((s) => servedBySession.get(s));
const minServed = Math.min(...counts);
const maxServed = Math.max(...counts);
if (minServed !== TURNS || maxServed !== TURNS) {
  violations.push(
    `service distribution is uneven: min ${minServed}, max ${maxServed}, expected exactly ${TURNS} each`
  );
}
const totalAdmissions = counts.reduce((a, b) => a + b, 0);
if (totalAdmissions !== SESSIONS * TURNS) {
  violations.push(`total admissions ${totalAdmissions}, expected ${SESSIONS * TURNS}`);
}
for (const account of ACCOUNTS) {
  const peak = peakByConnection.get(account.id) ?? 0;
  if (peak > account.maxConcurrent) {
    violations.push(
      `over-admission on ${account.id}: peak ${peak} exceeded capacity ${account.maxConcurrent}`
    );
  }
}
// Every account must have carried real traffic, or the "distribution" above is
// an artefact of one account doing all the work.
for (const account of ACCOUNTS) {
  if ((servedByConnection.get(account.id) ?? 0) === 0) {
    violations.push(`${account.id} served nothing — the spread is not real`);
  }
}

// ── verdict ─────────────────────────────────────────────────────────────────
console.log(
  `sessions=${SESSIONS} turns=${TURNS} slots=${TOTAL_SLOTS} admissions=${totalAdmissions} ` +
    `refusals=${refusals} maxOvertakes=${maxOvertakes}/${TOTAL_SLOTS} inFlight=${registry.inFlight()}`
);
console.log(
  'per-connection: ' +
    ACCOUNTS.map(
      (a) =>
        `${a.id} served=${servedByConnection.get(a.id) ?? 0} peak=${peakByConnection.get(a.id) ?? 0}/${a.maxConcurrent}`
    ).join('  ')
);

if (violations.length > 0) {
  console.error('PARALLELISM_FAILED');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log(`PARALLELISM_OK ${SESSIONS}`);
process.exit(0);
