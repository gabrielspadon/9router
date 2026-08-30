import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { validateAntigravityVerificationUrl } from "../../open-sse/services/antigravityValidation.js";
import { getUsageForProvider } from "open-sse/services/usage.js";

const TTL_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const LIVE_CAP = 256;
const LEDGER_CAP = 1024;

const liveByConnection = new Map();
const seenObservations = new Map();
const activeLifetimeByConnection = new Map();
const events = new EventEmitter();
let generation = 0;

function ledgerKey(connectionId, observationId) {
  return `${connectionId}\u0000${observationId}`;
}

function publicEntry(entry) {
  return {
    connectionId: entry.connectionId,
    challengeId: entry.challengeId,
    expiresAt: entry.expiresAt,
  };
}

function emitRemove(entry) {
  events.emit("change", { type: "remove", ...publicEntry(entry) });
}

function removeLiveEntry(connectionId, entry = liveByConnection.get(connectionId)) {
  if (!entry || liveByConnection.get(connectionId) !== entry) return false;
  liveByConnection.delete(connectionId);
  emitRemove(entry);
  return true;
}

function evictExpired(now = Date.now()) {
  for (const [key, seen] of seenObservations) {
    if (now - seen.seenAt >= TTL_MS) seenObservations.delete(key);
  }
  for (const [connectionId, entry] of liveByConnection) {
    if (now >= entry.expiresAt) removeLiveEntry(connectionId, entry);
  }
}

function evictOldestLiveEntry() {
  let oldest = null;
  for (const entry of liveByConnection.values()) {
    if (!oldest || entry.observedAt < oldest.observedAt) oldest = entry;
  }
  if (oldest) removeLiveEntry(oldest.connectionId, oldest);
}

function evictOldestLedgerEntry() {
  const oldestKey = seenObservations.keys().next().value;
  if (oldestKey !== undefined) seenObservations.delete(oldestKey);
}

function lifetimeIsCurrent(connectionId, lifetime) {
  return lifetime === undefined || activeLifetimeByConnection.get(connectionId) === lifetime;
}

function getOrCreateConnectionLifetime(connectionId) {
  let lifetime = activeLifetimeByConnection.get(connectionId);
  if (!lifetime) {
    lifetime = Symbol(`antigravity-verification:${connectionId}`);
    activeLifetimeByConnection.set(connectionId, lifetime);
  }
  return lifetime;
}

function nextGeneration() {
  if (generation >= Number.MAX_SAFE_INTEGER) throw new Error("Antigravity verification generation exhausted");
  generation += 1;
  return generation;
}

export function getAntigravityVerificationSnapshot() {
  evictExpired();
  return [...liveByConnection.values()].map(publicEntry);
}

export function getAntigravityVerification(connectionId) {
  evictExpired();
  const entry = liveByConnection.get(connectionId);
  if (!entry) return null;
  return {
    connectionId: entry.connectionId,
    challengeId: entry.challengeId,
    generation: entry.generation,
    observationId: entry.observationId,
    expiresAt: entry.expiresAt,
    href: entry.url,
  };
}

export function subscribeAntigravityVerification(listener) {
  events.on("change", listener);
  return () => events.off("change", listener);
}

export function recordAntigravityValidation(connectionId, { validation, observationId } = {}, connectionLifetime = undefined) {
  if (!connectionId || !observationId || !lifetimeIsCurrent(connectionId, connectionLifetime)) return false;
  const url = validateAntigravityVerificationUrl(validation?.url);
  if (!url || validation?.kind !== "antigravity_validation_required") return false;

  const now = Date.now();
  evictExpired(now);
  const key = ledgerKey(connectionId, observationId);
  if (seenObservations.has(key)) return false;

  while (seenObservations.size >= LEDGER_CAP) evictOldestLedgerEntry();
  seenObservations.set(key, { connectionId, observationId, seenAt: now });

  const existing = liveByConnection.get(connectionId);
  if (!existing && liveByConnection.size >= LIVE_CAP) evictOldestLiveEntry();
  const entry = {
    connectionId,
    challengeId: crypto.randomUUID(),
    generation: nextGeneration(),
    observationId,
    url,
    observedAt: now,
    expiresAt: now + TTL_MS,
  };
  liveByConnection.set(connectionId, entry);
  events.emit("change", { type: "upsert", ...publicEntry(entry) });
  return true;
}

export function clearAntigravityVerificationIfCurrent(connectionId, challengeId, connectionLifetime = undefined) {
  if (!connectionId || !challengeId || !lifetimeIsCurrent(connectionId, connectionLifetime)) return false;
  evictExpired();
  const current = liveByConnection.get(connectionId);
  if (!current || current.challengeId !== challengeId) return false;
  return removeLiveEntry(connectionId, current);
}

export function invalidateAntigravityVerificationConnection(connectionId) {
  if (!connectionId) return false;
  const hadLifetime = activeLifetimeByConnection.delete(connectionId);
  const hadLive = removeLiveEntry(connectionId);
  let hadLedger = false;
  for (const [key, entry] of seenObservations) {
    if (entry.connectionId === connectionId) {
      seenObservations.delete(key);
      hadLedger = true;
    }
  }
  return hadLifetime || hadLive || hadLedger;
}

export function createAntigravityVerificationHooks(connectionId, expectedChallengeId) {
  const connectionLifetime = getOrCreateConnectionLifetime(connectionId);
  const current = getAntigravityVerification(connectionId);
  const challengeIdAtStart = expectedChallengeId === undefined
    ? current?.challengeId ?? null
    : expectedChallengeId;
  const observationId = crypto.randomUUID();
  return {
    verificationContext: { connectionId, observationId, challengeIdAtStart },
    onValidationRequired: ({ validation, observationId: observedId }) =>
      recordAntigravityValidation(connectionId, { validation, observationId: observedId }, connectionLifetime),
    onVerificationSuccess: ({ challengeId }) =>
      clearAntigravityVerificationIfCurrent(connectionId, challengeId, connectionLifetime),
  };
}

export async function runAntigravityUsageProbe(connection, proxyOptions, options = {}) {
  const hooks = createAntigravityVerificationHooks(
    connection.id,
    options.expectedChallengeId,
  );
  return getUsageForProvider(connection, proxyOptions, {
    force: options.force === true,
    verificationContext: hooks.verificationContext,
    onValidationRequired: hooks.onValidationRequired,
    onVerificationSuccess: hooks.onVerificationSuccess,
  });
}

const cleanupTimer = setInterval(evictExpired, CLEANUP_INTERVAL_MS);
cleanupTimer.unref?.();
