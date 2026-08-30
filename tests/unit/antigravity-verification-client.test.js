import { describe, expect, it, vi } from "vitest";
import { createAntigravityVerificationClient } from "@/app/(dashboard)/dashboard/providers/[id]/useAntigravityVerification.js";

const STREAM_URL = "/api/providers/antigravity/verification/stream";
const DETAILS = "/api/providers/antigravity/verification";
const SAFE_HREF = "https://accounts.google.com/AccountChooser?token=opaque";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function response({ status = 200, body = null, json = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    body,
    json: vi.fn().mockResolvedValue(json),
  };
}

class FakeEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  close() {
    this.closed = true;
  }

  emit(type, payload) {
    this.listeners.get(type)?.({ data: JSON.stringify(payload) });
  }

  error() {
    this.listeners.get("error")?.({});
  }
}

function setup({ fetchImpl, now = () => 1_000 } = {}) {
  FakeEventSource.instances = [];
  const states = [];
  const timers = new Map();
  let timerId = 0;
  const client = createAntigravityVerificationClient({
    EventSourceImpl: FakeEventSource,
    fetchImpl: fetchImpl || vi.fn(),
    now,
    setTimeoutImpl: (fn, delay) => {
      timerId += 1;
      timers.set(timerId, { fn, delay });
      return timerId;
    },
    clearTimeoutImpl: (id) => timers.delete(id),
    onState: (state) => states.push(state),
  });
  return { client, states, timers, fetchImpl: client.fetchImpl };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function snapshot(entries) {
  return { entries };
}

function entry(connectionId = "conn-a", challengeId = "challenge-a", expiresAt = 9_000) {
  return { connectionId, challengeId, expiresAt };
}

function detail(challengeId = "challenge-a", expiresAt = 9_000, href = SAFE_HREF) {
  return { challengeId, expiresAt, href };
}

describe("Antigravity verification client transport", () => {
  it("does nothing while disabled", async () => {
    const fetchImpl = vi.fn();
    const { client } = setup({ fetchImpl });

    await client.start({ enabled: false });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("preflights the status-visible stream once, cancels its body, and opens one source", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn().mockResolvedValue(response({ body: { cancel } }));
    const { client } = setup({ fetchImpl });

    await client.start({ enabled: true });

    expect(fetchImpl).toHaveBeenCalledWith(STREAM_URL, { credentials: "same-origin" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe(STREAM_URL);
  });

  it("fetches exact detail for every authoritative snapshot entry", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ json: detail() }));
    const { client, states } = setup({ fetchImpl });
    await client.start({ enabled: true });

    FakeEventSource.instances[0].emit("snapshot", snapshot([entry()]));
    await flush();

    expect(fetchImpl).toHaveBeenLastCalledWith(`${DETAILS}/conn-a`, { credentials: "same-origin" });
    expect(states.at(-1).byConnectionId["conn-a"]).toMatchObject({ href: SAFE_HREF, challengeId: "challenge-a" });
  });

  it("fetches exact detail for an upsert", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ json: detail("challenge-b") }));
    const { client, states } = setup({ fetchImpl });
    await client.start({ enabled: true });

    FakeEventSource.instances[0].emit("upsert", entry("conn-a", "challenge-b"));
    await flush();

    expect(fetchImpl).toHaveBeenLastCalledWith(`${DETAILS}/conn-a`, { credentials: "same-origin" });
    expect(states.at(-1).byConnectionId["conn-a"]).toMatchObject({ challengeId: "challenge-b", href: SAFE_HREF });
  });

  it("removes only a matching challenge", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ json: detail() }));
    const { client, states } = setup({ fetchImpl });
    await client.start({ enabled: true });
    FakeEventSource.instances[0].emit("snapshot", snapshot([entry()]));
    await flush();

    FakeEventSource.instances[0].emit("remove", { connectionId: "conn-a", challengeId: "other" });
    expect(states.at(-1).byConnectionId["conn-a"]).toBeDefined();

    FakeEventSource.instances[0].emit("remove", { connectionId: "conn-a", challengeId: "challenge-a" });
    expect(states.at(-1).byConnectionId["conn-a"]).toBeUndefined();
  });

  it("clears href on local expiry", async () => {
    let currentNow = 1_000;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ json: detail("challenge-a", 2_000) }));
    const { client, states, timers } = setup({ fetchImpl, now: () => currentNow });
    await client.start({ enabled: true });
    FakeEventSource.instances[0].emit("snapshot", snapshot([entry("conn-a", "challenge-a", 2_000)]));
    await flush();
    currentNow = 2_000;
    [...timers.values()][0].fn();

    expect(states.at(-1).byConnectionId["conn-a"]).toMatchObject({ href: null, error: "Verification link expired" });
  });

  it("drops href on failed detail without exposing route diagnostics", async () => {
    const opaque = "opaque-detail-diagnostic";
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ status: 500, json: { error: opaque } }));
    const { client, states } = setup({ fetchImpl });
    await client.start({ enabled: true });
    FakeEventSource.instances[0].emit("snapshot", snapshot([entry()]));
    await flush();

    expect(states.at(-1).byConnectionId["conn-a"]).toMatchObject({ href: null, error: "Unable to load verification link" });
    expect(JSON.stringify(states)).not.toContain(opaque);
  });

  it("denies preflight access without a source or href", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ status: 401 }));
    const { client, states } = setup({ fetchImpl });

    await client.start({ enabled: true });

    expect(FakeEventSource.instances).toHaveLength(0);
    expect(states.at(-1)).toEqual({ byConnectionId: {}, accessDenied: true });
  });

  it("denies detail access, clears href, and closes the source", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ status: 403 }));
    const { client, states } = setup({ fetchImpl });
    await client.start({ enabled: true });
    FakeEventSource.instances[0].emit("snapshot", snapshot([entry()]));
    await flush();

    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(states.at(-1)).toEqual({ byConnectionId: {}, accessDenied: true });
  });

  it("closes its only source and clears timers on stop or navigation", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ json: detail() }));
    const { client, timers } = setup({ fetchImpl });
    await client.start({ enabled: true });
    FakeEventSource.instances[0].emit("snapshot", snapshot([entry()]));
    await flush();

    client.stop();

    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(timers.size).toBe(0);
  });

  it("does not let a stale detail response overwrite a newer challenge", async () => {
    const oldDetail = deferred();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce({ status: 200, ok: true, json: () => oldDetail.promise })
      .mockResolvedValueOnce(response({ json: detail("challenge-b", 9_000, `${SAFE_HREF}&new=1`) }));
    const { client, states } = setup({ fetchImpl });
    await client.start({ enabled: true });
    FakeEventSource.instances[0].emit("snapshot", snapshot([entry()]));
    await flush();
    FakeEventSource.instances[0].emit("upsert", entry("conn-a", "challenge-b"));
    await flush();
    oldDetail.resolve(detail("challenge-a", 9_000, `${SAFE_HREF}&old=1`));
    await flush();

    expect(states.at(-1).byConnectionId["conn-a"]).toMatchObject({ challengeId: "challenge-b", href: `${SAFE_HREF}&new=1` });
  });

  it("sends only an explicit same-origin JSON POST recheck", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ json: detail() }))
      .mockResolvedValueOnce(response({ json: { verified: false } }));
    const { client } = setup({ fetchImpl });
    await client.start({ enabled: true });
    FakeEventSource.instances[0].emit("snapshot", snapshot([entry()]));
    await flush();

    await client.recheck("conn-a");

    expect(fetchImpl).toHaveBeenLastCalledWith(`${DETAILS}/conn-a/recheck`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId: "challenge-a" }),
    });
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("/api/usage/stream"))).toBe(false);
  });

  it("treats an authoritative snapshot as a complete set and removes absent entries", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ json: detail("challenge-a") }))
      .mockResolvedValueOnce(response({ json: detail("challenge-b") }));
    const { client, states } = setup({ fetchImpl });
    await client.start({ enabled: true });
    FakeEventSource.instances[0].emit("snapshot", snapshot([entry("conn-a", "challenge-a"), entry("conn-b", "challenge-b")]));
    await flush();
    FakeEventSource.instances[0].emit("snapshot", snapshot([entry("conn-b", "challenge-b")]));
    await flush();

    expect(states.at(-1).byConnectionId["conn-a"]).toBeUndefined();
    expect(states.at(-1).byConnectionId["conn-b"]).toBeDefined();
  });

  it("clears an old href and timer before a mismatched snapshot replacement", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ json: detail("challenge-a") }))
      .mockResolvedValueOnce(response({ json: detail("challenge-b") }));
    const { client, states, timers } = setup({ fetchImpl });
    await client.start({ enabled: true });
    FakeEventSource.instances[0].emit("snapshot", snapshot([entry()]));
    await flush();
    expect(timers.size).toBeGreaterThan(0);

    FakeEventSource.instances[0].emit("snapshot", snapshot([entry("conn-a", "challenge-b")]));
    expect(states.at(-1).byConnectionId["conn-a"]).toMatchObject({ challengeId: "challenge-b", href: null });
    await flush();
    expect(states.at(-1).byConnectionId["conn-a"].href).toBe(SAFE_HREF);
  });

  it("invalidates an old detail promise even when a snapshot repeats its challenge", async () => {
    const oldDetail = deferred();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce({ status: 200, ok: true, json: () => oldDetail.promise })
      .mockResolvedValueOnce(response({ json: detail("challenge-a", 9_000, `${SAFE_HREF}&fresh=1`) }));
    const { client, states } = setup({ fetchImpl });
    await client.start({ enabled: true });
    FakeEventSource.instances[0].emit("snapshot", snapshot([entry()]));
    await flush();
    FakeEventSource.instances[0].emit("snapshot", snapshot([entry()]));
    await flush();
    oldDetail.resolve(detail("challenge-a", 9_000, `${SAFE_HREF}&stale=1`));
    await flush();

    expect(states.at(-1).byConnectionId["conn-a"].href).toBe(`${SAFE_HREF}&fresh=1`);
  });

  it("clears hrefs on source error without opening a second source and accepts the next snapshot", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ json: detail() }))
      .mockResolvedValueOnce(response({ json: detail("challenge-b") }));
    const { client, states, timers } = setup({ fetchImpl });
    await client.start({ enabled: true });
    const source = FakeEventSource.instances[0];
    source.emit("snapshot", snapshot([entry()]));
    await flush();

    source.error();
    expect(states.at(-1).byConnectionId).toEqual({});
    expect(timers.size).toBe(0);
    expect(FakeEventSource.instances).toHaveLength(1);

    source.emit("snapshot", snapshot([entry("conn-a", "challenge-b")]));
    await flush();
    expect(states.at(-1).byConnectionId["conn-a"]).toMatchObject({ challengeId: "challenge-b", href: SAFE_HREF });
  });
});
