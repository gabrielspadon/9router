import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const URL = "https://accounts.google.com/AccountChooser?continue=https%3A%2F%2Fcloudcode-pa.googleapis.com%2Fv1internal%3AloadCodeAssist&flowName=GlifWebSignIn&opaque=project-secret";
const validation = { kind: "antigravity_validation_required", url: URL, source: "usage" };

async function loadStore() {
  vi.resetModules();
  return import("../../src/lib/antigravityVerification.js");
}

function record(store, connectionId, observationId) {
  return store.recordAntigravityValidation(connectionId, { validation, observationId });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-30T12:00:00.000Z"));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Antigravity verification state", () => {
  it("keeps challenges isolated by connection", async () => {
    const store = await loadStore();
    record(store, "conn-a", "obs-a");
    record(store, "conn-b", "obs-b");

    expect(store.getAntigravityVerificationSnapshot()).toHaveLength(2);
    expect(store.getAntigravityVerification("conn-a").href).toBe(URL);
    expect(store.getAntigravityVerification("conn-b").href).toBe(URL);
  });

  it("assigns globally increasing safe-integer generations", async () => {
    const store = await loadStore();
    record(store, "conn-a", "obs-a");
    record(store, "conn-b", "obs-b");

    const a = store.getAntigravityVerification("conn-a");
    const b = store.getAntigravityVerification("conn-b");
    expect(Number.isSafeInteger(a.generation)).toBe(true);
    expect(b.generation).toBe(a.generation + 1);
  });

  it("records one observation only once without refreshing expiry or emitting", async () => {
    const store = await loadStore();
    const events = [];
    const unsubscribe = store.subscribeAntigravityVerification((event) => events.push(event));
    expect(record(store, "conn-a", "obs-a")).toBe(true);
    const first = store.getAntigravityVerification("conn-a");
    vi.advanceTimersByTime(60_000);

    expect(record(store, "conn-a", "obs-a")).toBe(false);
    expect(store.getAntigravityVerification("conn-a").expiresAt).toBe(first.expiresAt);
    expect(events).toEqual([{ type: "upsert", connectionId: "conn-a", challengeId: first.challengeId, expiresAt: first.expiresAt }]);
    unsubscribe();
  });

  it("does not let a delayed old observation replace a newer challenge", async () => {
    const store = await loadStore();
    record(store, "conn-a", "old");
    const old = store.getAntigravityVerification("conn-a");
    record(store, "conn-a", "new");
    const current = store.getAntigravityVerification("conn-a");

    expect(current.challengeId).not.toBe(old.challengeId);
    expect(record(store, "conn-a", "old")).toBe(false);
    expect(store.getAntigravityVerification("conn-a").challengeId).toBe(current.challengeId);
  });

  it("allows an older validation callback until a newer hook records an outcome", async () => {
    const store = await loadStore();
    const olderA = store.createAntigravityVerificationHooks("conn-a");
    const newerB = store.createAntigravityVerificationHooks("conn-a");

    expect(olderA.onValidationRequired({
      validation,
      observationId: olderA.verificationContext.observationId,
    })).toBe(true);
    const first = store.getAntigravityVerification("conn-a");

    expect(newerB.onValidationRequired({
      validation,
      observationId: newerB.verificationContext.observationId,
    })).toBe(true);
    const current = store.getAntigravityVerification("conn-a");

    expect(olderA.onValidationRequired({
      validation,
      observationId: `${olderA.verificationContext.observationId}-late`,
    })).toBe(false);
    expect(current.challengeId).not.toBe(first.challengeId);
    expect(store.getAntigravityVerification("conn-a").challengeId).toBe(current.challengeId);
  });

  it("allows an older matching success until a newer hook records an outcome", async () => {
    const store = await loadStore();
    record(store, "conn-a", "pending");
    const pending = store.getAntigravityVerification("conn-a");
    const olderA = store.createAntigravityVerificationHooks("conn-a");
    store.createAntigravityVerificationHooks("conn-a");

    expect(olderA.onVerificationSuccess({ challengeId: pending.challengeId })).toBe(true);
    expect(store.getAntigravityVerification("conn-a")).toBeNull();
  });

  it("rejects an older hook callback after a newer hook has observed its challenge", async () => {
    const store = await loadStore();
    const olderA = store.createAntigravityVerificationHooks("conn-a");
    const newerB = store.createAntigravityVerificationHooks("conn-a");

    expect(newerB.onValidationRequired({
      validation,
      observationId: newerB.verificationContext.observationId,
    })).toBe(true);
    const current = store.getAntigravityVerification("conn-a");

    expect(olderA.onValidationRequired({
      validation,
      observationId: olderA.verificationContext.observationId,
    })).toBe(false);
    expect(store.getAntigravityVerification("conn-a").challengeId).toBe(current.challengeId);
  });

  it("does not let a dismissed observation resurrect a challenge", async () => {
    const store = await loadStore();
    record(store, "conn-a", "obs-a");
    const current = store.getAntigravityVerification("conn-a");
    expect(store.clearAntigravityVerificationIfCurrent("conn-a", current.challengeId)).toBe(true);

    expect(record(store, "conn-a", "obs-a")).toBe(false);
    expect(store.getAntigravityVerification("conn-a")).toBeNull();
  });

  it("expires a challenge lazily after ten minutes", async () => {
    const store = await loadStore();
    record(store, "conn-a", "obs-a");
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);

    expect(store.getAntigravityVerification("conn-a")).toBeNull();
    expect(store.getAntigravityVerificationSnapshot()).toEqual([]);
  });

  it("expires a challenge in the one-minute sweep", async () => {
    const store = await loadStore();
    const events = [];
    store.subscribeAntigravityVerification((event) => events.push(event));
    record(store, "conn-a", "obs-a");
    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(store.getAntigravityVerificationSnapshot()).toEqual([]);
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: "remove", connectionId: "conn-a" }));
    expect(events.at(-1)).not.toHaveProperty("href");
  });

  it("unreferences the cleanup timer", async () => {
    const unref = vi.fn();
    vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref });
    await loadStore();
    expect(unref).toHaveBeenCalledOnce();
  });

  it("evicts the oldest observed entry when the live cap is exceeded", async () => {
    const store = await loadStore();
    for (let i = 0; i <= 256; i += 1) record(store, `conn-${i}`, `obs-${i}`);

    expect(store.getAntigravityVerificationSnapshot()).toHaveLength(256);
    expect(store.getAntigravityVerification("conn-0")).toBeNull();
    expect(store.getAntigravityVerification("conn-256")).not.toBeNull();
  });

  it("starts empty after module reload", async () => {
    const first = await loadStore();
    record(first, "conn-a", "obs-a");
    const second = await loadStore();
    expect(second.getAntigravityVerificationSnapshot()).toEqual([]);
  });

  it("bounds the observation ledger and evicts its oldest pair", async () => {
    const store = await loadStore();
    for (let i = 0; i <= 1024; i += 1) record(store, "conn-a", `obs-${i}`);

    expect(record(store, "conn-a", "obs-0")).toBe(true);
    expect(record(store, "conn-a", "obs-1024")).toBe(false);
  });

  it("expires observation-ledger entries after ten minutes", async () => {
    const store = await loadStore();
    record(store, "conn-a", "obs-a");
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);

    expect(record(store, "conn-a", "obs-a")).toBe(true);
  });

  it("deleting a connection clears its entry and observation ledger", async () => {
    const store = await loadStore();
    record(store, "conn-a", "obs-a");
    expect(store.invalidateAntigravityVerificationConnection("conn-a")).toBe(true);
    expect(store.getAntigravityVerification("conn-a")).toBeNull();
    expect(record(store, "conn-a", "obs-a")).toBe(true);
  });

  it("rejects a stale dismissal without exposing the current challenge", async () => {
    const store = await loadStore();
    record(store, "conn-a", "old");
    const old = store.getAntigravityVerification("conn-a");
    record(store, "conn-a", "new");

    expect(store.clearAntigravityVerificationIfCurrent("conn-a", old.challengeId)).toBe(false);
    expect(store.getAntigravityVerification("conn-a").challengeId).not.toBe(old.challengeId);
  });

  it("clears a matching current challenge", async () => {
    const store = await loadStore();
    record(store, "conn-a", "obs-a");
    const current = store.getAntigravityVerification("conn-a");

    expect(store.clearAntigravityVerificationIfCurrent("conn-a", current.challengeId)).toBe(true);
    expect(store.getAntigravityVerification("conn-a")).toBeNull();
  });

  it("does not let an older success clear a newer challenge", async () => {
    const store = await loadStore();
    const old = store.createAntigravityVerificationHooks("conn-a");
    old.onValidationRequired({ validation, observationId: old.verificationContext.observationId });
    const first = store.getAntigravityVerification("conn-a");
    const newer = store.createAntigravityVerificationHooks("conn-a");
    newer.onValidationRequired({ validation, observationId: newer.verificationContext.observationId });
    const current = store.getAntigravityVerification("conn-a");

    expect(old.onVerificationSuccess({ challengeId: first.challengeId })).toBe(false);
    expect(store.getAntigravityVerification("conn-a").challengeId).toBe(current.challengeId);
  });

  it.each(["chat", "project", "usage"])("ignores released %s hook callbacks after same-ID replacement", async () => {
    const store = await loadStore();
    const old = store.createAntigravityVerificationHooks("conn-a");
    old.onValidationRequired({ validation, observationId: old.verificationContext.observationId });
    store.invalidateAntigravityVerificationConnection("conn-a");
    const fresh = store.createAntigravityVerificationHooks("conn-a");
    fresh.onValidationRequired({ validation, observationId: fresh.verificationContext.observationId });
    const current = store.getAntigravityVerification("conn-a");

    expect(old.onValidationRequired({ validation, observationId: `${old.verificationContext.observationId}-late` })).toBe(false);
    expect(old.onVerificationSuccess({ challengeId: current.challengeId })).toBe(false);
    expect(store.getAntigravityVerification("conn-a").challengeId).toBe(current.challengeId);
    expect(fresh.onVerificationSuccess({ challengeId: current.challengeId })).toBe(true);
  });
});
