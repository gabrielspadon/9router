"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const STREAM_URL = "/api/providers/antigravity/verification/stream";
const DETAIL_BASE_URL = "/api/providers/antigravity/verification";
const DETAIL_ERROR = "Unable to load verification link";
const EXPIRED_ERROR = "Verification link expired";
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const MAX_URL_BYTES = 8_192;

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function validateClientHref(candidate) {
  if (typeof candidate !== "string" || candidate !== candidate.trim()) return null;
  if (candidate.length === 0 || CONTROL_RE.test(candidate) || byteLength(candidate) > MAX_URL_BYTES) return null;
  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== "https:"
      || parsed.hostname !== "accounts.google.com"
      || parsed.port !== ""
      || parsed.username !== ""
      || parsed.password !== ""
      || byteLength(parsed.href) > MAX_URL_BYTES
    ) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function parseEntry(value, now) {
  const connectionId = value?.connectionId;
  const challengeId = value?.challengeId;
  const expiresAt = Number(value?.expiresAt);
  if (
    typeof connectionId !== "string" || connectionId.length === 0
    || typeof challengeId !== "string" || challengeId.length === 0
    || !Number.isFinite(expiresAt) || expiresAt <= now
  ) return null;
  return { connectionId, challengeId, expiresAt };
}

function publicState(entries, accessDenied) {
  return {
    byConnectionId: Object.fromEntries([...entries].map(([connectionId, entry]) => [connectionId, {
      connectionId,
      challengeId: entry.challengeId,
      expiresAt: entry.expiresAt,
      href: entry.href,
      rechecking: entry.rechecking,
      error: entry.error,
    }])),
    accessDenied,
  };
}

/**
 * One page-scoped client for the sensitive Antigravity verification routes.
 * It receives only sanitized stream metadata and retains an href only in this
 * controller's local component state after authenticated detail validation.
 */
export function createAntigravityVerificationClient({
  EventSourceImpl,
  fetchImpl,
  now = () => Date.now(),
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  onState = () => {},
}) {
  const entries = new Map();
  let source = null;
  let accessDenied = false;
  let stopped = false;
  let startPromise = null;
  let lifecycle = 0;

  const publish = () => onState(publicState(entries, accessDenied));

  const clearTimer = (entry) => {
    if (entry?.expiryTimer != null) clearTimeoutImpl(entry.expiryTimer);
    if (entry) entry.expiryTimer = null;
  };

  const removeEntry = (connectionId) => {
    const entry = entries.get(connectionId);
    if (!entry) return false;
    entry.detailEpoch += 1;
    clearTimer(entry);
    entries.delete(connectionId);
    return true;
  };

  const clearAll = () => {
    for (const connectionId of entries.keys()) removeEntry(connectionId);
  };

  const stop = () => {
    lifecycle += 1;
    stopped = true;
    source?.close?.();
    source = null;
    clearAll();
    publish();
  };

  const denyAccess = () => {
    lifecycle += 1;
    stopped = true;
    source?.close?.();
    source = null;
    clearAll();
    accessDenied = true;
    publish();
  };

  const scheduleExpiry = (entry) => {
    clearTimer(entry);
    const delay = Math.max(0, entry.expiresAt - now());
    entry.expiryTimer = setTimeoutImpl(() => {
      if (entries.get(entry.connectionId) !== entry) return;
      entry.detailEpoch += 1;
      entry.href = null;
      entry.rechecking = false;
      entry.error = EXPIRED_ERROR;
      entry.expiryTimer = null;
      publish();
    }, delay);
  };

  const detailFailed = (entry, error = DETAIL_ERROR) => {
    if (entries.get(entry.connectionId) !== entry) return;
    clearTimer(entry);
    entry.href = null;
    entry.rechecking = false;
    entry.error = error;
    publish();
  };

  const loadDetail = async (entry) => {
    const detailEpoch = entry.detailEpoch + 1;
    entry.detailEpoch = detailEpoch;
    let response;
    try {
      response = await fetchImpl(`${DETAIL_BASE_URL}/${encodeURIComponent(entry.connectionId)}`, { credentials: "same-origin" });
    } catch {
      detailFailed(entry);
      return;
    }
    if (entries.get(entry.connectionId) !== entry || entry.detailEpoch !== detailEpoch || stopped) return;
    if (!response || typeof response !== "object") {
      detailFailed(entry);
      return;
    }
    if (response.status === 401 || response.status === 403) {
      denyAccess();
      return;
    }
    if (!response.ok) {
      detailFailed(entry);
      return;
    }
    let detail;
    try {
      detail = await response.json();
    } catch {
      detailFailed(entry);
      return;
    }
    if (entries.get(entry.connectionId) !== entry || entry.detailEpoch !== detailEpoch || stopped) return;
    if (detail?.challengeId !== entry.challengeId || Number(detail?.expiresAt) !== entry.expiresAt) {
      detailFailed(entry);
      return;
    }
    if (entry.expiresAt <= now()) {
      detailFailed(entry, EXPIRED_ERROR);
      return;
    }
    const href = validateClientHref(detail?.href);
    if (!href) {
      detailFailed(entry);
      return;
    }
    entry.href = href;
    entry.error = null;
    scheduleExpiry(entry);
    publish();
  };

  const replaceEntry = (rawEntry) => {
    const next = parseEntry(rawEntry, now());
    if (!next) return;
    removeEntry(next.connectionId);
    const entry = {
      ...next,
      href: null,
      rechecking: false,
      error: null,
      detailEpoch: 0,
      expiryTimer: null,
    };
    entries.set(entry.connectionId, entry);
    publish();
    void loadDetail(entry);
  };

  const reconcileSnapshot = (payload) => {
    const snapshotEntries = Array.isArray(payload?.entries)
      ? payload.entries.map((value) => parseEntry(value, now())).filter(Boolean)
      : [];
    const snapshotByConnection = new Map(snapshotEntries.map((entry) => [entry.connectionId, entry]));
    for (const connectionId of [...entries.keys()]) removeEntry(connectionId);
    for (const entry of snapshotByConnection.values()) {
      entries.set(entry.connectionId, {
        ...entry,
        href: null,
        rechecking: false,
        error: null,
        detailEpoch: 0,
        expiryTimer: null,
      });
    }
    publish();
    for (const entry of entries.values()) void loadDetail(entry);
  };

  const onSnapshot = (event) => {
    try {
      reconcileSnapshot(JSON.parse(event.data));
    } catch {
      // A malformed sanitized event cannot create client state.
    }
  };

  const onUpsert = (event) => {
    try {
      replaceEntry(JSON.parse(event.data));
    } catch {
      // A malformed sanitized event cannot create client state.
    }
  };

  const onRemove = (event) => {
    try {
      const payload = JSON.parse(event.data);
      const current = entries.get(payload?.connectionId);
      if (!current || current.challengeId !== payload?.challengeId) return;
      removeEntry(current.connectionId);
      publish();
    } catch {
      // A malformed sanitized event cannot remove client state.
    }
  };

  const onStreamError = () => {
    if (stopped) return;
    clearAll();
    publish();
  };

  const start = async ({ enabled = true } = {}) => {
    if (!enabled || source || startPromise) return startPromise;
    stopped = false;
    accessDenied = false;
    const currentLifecycle = ++lifecycle;
    startPromise = (async () => {
      let response;
      try {
        response = await fetchImpl(STREAM_URL, { credentials: "same-origin" });
      } catch {
        publish();
        return;
      }
      if (stopped || lifecycle !== currentLifecycle) return;
      if (!response || typeof response !== "object") {
        publish();
        return;
      }
      try {
        await response.body?.cancel?.();
      } catch {
        // The preflight body is never parsed. Failure to cancel cannot expose it.
      }
      if (response.status === 401 || response.status === 403) {
        denyAccess();
        return;
      }
      if (!response.ok || stopped || lifecycle !== currentLifecycle) {
        publish();
        return;
      }
      source = new EventSourceImpl(STREAM_URL);
      source.addEventListener("snapshot", onSnapshot);
      source.addEventListener("upsert", onUpsert);
      source.addEventListener("remove", onRemove);
      source.addEventListener("error", onStreamError);
      publish();
    })().finally(() => {
      startPromise = null;
    });
    return startPromise;
  };

  const recheck = async (connectionId) => {
    const entry = entries.get(connectionId);
    if (!entry || !entry.challengeId || stopped) return;
    const challengeId = entry.challengeId;
    entry.rechecking = true;
    entry.error = null;
    publish();
    let response;
    try {
      response = await fetchImpl(`${DETAIL_BASE_URL}/${encodeURIComponent(connectionId)}/recheck`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId }),
      });
    } catch {
      detailFailed(entry);
      return;
    }
    if (entries.get(connectionId) !== entry || entry.challengeId !== challengeId || stopped) return;
    if (response.status === 401 || response.status === 403) {
      denyAccess();
      return;
    }
    if (!response.ok) {
      detailFailed(entry);
      return;
    }
    entry.rechecking = false;
    publish();
  };

  return { start, stop, recheck };
}

export function useAntigravityVerification({ enabled }) {
  const [state, setState] = useState({ byConnectionId: {}, accessDenied: false });
  const clientRef = useRef(null);

  useEffect(() => {
    if (!enabled) {
      clientRef.current?.stop();
      clientRef.current = null;
      return undefined;
    }
    const client = createAntigravityVerificationClient({
      EventSourceImpl: EventSource,
      fetchImpl: fetch,
      onState: setState,
    });
    clientRef.current = client;
    void client.start();
    return () => {
      client.stop();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [enabled]);

  const recheck = useCallback((connectionId) => clientRef.current?.recheck(connectionId) || Promise.resolve(), []);

  return { ...state, recheck };
}
