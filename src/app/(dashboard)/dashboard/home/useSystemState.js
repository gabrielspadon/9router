"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Refresh policy for the system-state contract. The endpoint deliberately holds
// no interval and no cache, so the whole policy lives here:
//
//   nothing is fetched while the tab is hidden, and a hidden tab that becomes
//   visible refreshes at once rather than waiting out the interval it slept
//   through;
//   one request is in flight at a time, and a new one aborts the old, so a slow
//   response can never overwrite a newer one;
//   a failure backs off rather than hammering, and the last good reading stays
//   on screen underneath an explicit stale marker, because a blank masthead is
//   less useful to an operator than an old number that says it is old.

const BASE_INTERVAL_MS = 20000;
const MAX_BACKOFF_MS = 160000;

export function useSystemState({ windowSeconds = 3600, intervalMs = BASE_INTERVAL_MS } = {}) {
  const [state, setState] = useState({
    data: null,
    error: null,
    phase: "idle", // idle | loading | refreshing | ready | failed
    fetchedAt: null,
  });

  const abortRef = useRef(null);
  const timerRef = useRef(null);
  const failuresRef = useRef(0);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({
      ...prev,
      phase: prev.data ? "refreshing" : "loading",
    }));

    try {
      const res = await fetch(`/api/system/state?windowSeconds=${windowSeconds}`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`system state responded ${res.status}`);
      const data = await res.json();
      if (!mountedRef.current || controller.signal.aborted) return;
      failuresRef.current = 0;
      setState({ data, error: null, phase: "ready", fetchedAt: Date.now() });
    } catch (err) {
      if (controller.signal.aborted || !mountedRef.current) return;
      failuresRef.current += 1;
      setState((prev) => ({
        ...prev,
        error: err?.message || String(err),
        phase: "failed",
      }));
    }
  }, [windowSeconds]);

  useEffect(() => {
    mountedRef.current = true;

    const schedule = () => {
      clearTimeout(timerRef.current);
      const backoff = Math.min(intervalMs * 2 ** failuresRef.current, MAX_BACKOFF_MS);
      timerRef.current = setTimeout(async () => {
        await load();
        schedule();
      }, failuresRef.current ? backoff : intervalMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        load();
        schedule();
      } else {
        clearTimeout(timerRef.current);
        abortRef.current?.abort();
      }
    };

    load();
    schedule();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
      abortRef.current?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, intervalMs]);

  return { ...state, refresh: load };
}
