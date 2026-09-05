"use client";

import { useState, useEffect, useCallback } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";

// Signed byte delta: negative means the session shrank its context. Values
// under 1 KiB stay in bytes so the rounding never hides a small save.
function formatSignedBytes(value) {
  if (value === null || value === undefined) return "none";
  const abs = Math.abs(value);
  const num = abs >= 1024 ? `${(abs / 1024).toFixed(1)} KB` : `${abs} B`;
  if (value < 0) return `\u2212${num}`;
  if (value > 0) return `+${num}`;
  return num;
}

export default function ContextMonitorClient() {
  const [status, setStatus] = useState("loading");
  const [entries, setEntries] = useState([]);
  const [generatedAt, setGeneratedAt] = useState(null);

  // 8s ceiling per poll: a wedged context-status route must not hold the
  // client open past one backoff step.
  const REQUEST_TIMEOUT_MS = 8000;
  const BASE_POLL_MS = 5000;
  const MAX_POLL_MS = 60000;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/context-status", {
        headers: { "Cache-Control": "no-store" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        setStatus("unavailable");
        return;
      }
      const data = await res.json();
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setGeneratedAt(data.generatedAt ?? null);
      setStatus("ready");
    } catch {
      setStatus("unavailable");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let failures = 0;
    let inFlight = false;
    let timer = null;
    // Consecutive-failure backoff: 2^failures * 5s capped at 60s, reset to 5s
    // on the first success. setTimeout chain (not setInterval) so a slow tick
    // can never overlap the next one.
    const schedule = () => {
      if (cancelled) return;
      const delay = Math.min(MAX_POLL_MS, BASE_POLL_MS * 2 ** failures);
      timer = setTimeout(() => void tick(), delay);
    };
    const tick = async () => {
      if (cancelled) return;
      if (document.hidden || inFlight) {
        // hidden tab or a manual Retry still running: poll again at base rate,
        // and never let two fetches overlap.
        timer = setTimeout(() => void tick(), BASE_POLL_MS);
        return;
      }
      inFlight = true;
      try {
        const res = await fetch("/api/context-status", {
          headers: { "Cache-Control": "no-store" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (cancelled) return;
        if (!res.ok) {
          failures++;
          setStatus("unavailable");
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        failures = 0;
        setEntries(Array.isArray(data.entries) ? data.entries : []);
        setGeneratedAt(data.generatedAt ?? null);
        setStatus("ready");
      } catch {
        if (!cancelled) {
          failures++;
          setStatus("unavailable");
        }
      } finally {
        inFlight = false;
        schedule();
      }
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="space-y-5.5">
      <Card id="context-monitor">
        <div className="flex items-center justify-between mb-2 gap-4 flex-wrap">
          <h2 className="text-lg font-semibold text-text-main flex items-center gap-2">
            <span
              className="material-symbols-outlined text-[20px] text-text-muted"
              aria-hidden="true"
            >
              monitoring
            </span>
            Context Monitor
          </h2>
          {generatedAt && (
            <p className="text-xs text-text-muted">
              updated {new Date(generatedAt).toLocaleTimeString()}
            </p>
          )}
        </div>

        {status === "loading" ? (
          <p className="text-sm text-text-muted">Loading session telemetry…</p>
        ) : status === "unavailable" ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-muted">
              Session telemetry is unavailable. The context status API did not
              respond.
            </p>
            <div>
              <Button variant="secondary" onClick={load}>
                Retry
              </Button>
            </div>
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-text-muted">
            No session telemetry yet. Telemetry appears after the first chat
            request of a session.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b border-border-subtle text-start text-xs text-text-muted">
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    Session
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-end font-medium"
                  >
                    Context tokens
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-end font-medium"
                  >
                    Saved
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-end font-medium"
                  >
                    Cache entries
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-start font-medium"
                  >
                    Compact
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-end font-medium"
                  >
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={`${entry.sid}:${entry.updatedAt}`}
                    className="border-b border-border-subtle last:border-b-0 hover:bg-surface-2 transition-colors duration-150"
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs">{entry.sid}</span>
                      {entry.rid && (
                        <span className="block text-xs text-text-muted">
                          {entry.rid}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <span className="metric">
                        {entry.ctxTokens === null
                          ? "none"
                          : entry.ctxTokens.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-end">
                      <span className="metric">
                        {formatSignedBytes(entry.saveBytes)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-end">
                      <span className="metric">
                        {formatSignedBytes(entry.ceBytes)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {entry.compactHint ? (
                        <span className="inline-flex items-center rounded-[var(--radius-brand)] bg-surface-2 px-2 py-1 text-xs font-medium text-text-main">
                          compact
                        </span>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end text-xs text-text-muted">
                      {entry.updatedAt
                        ? new Date(entry.updatedAt).toLocaleTimeString()
                        : "none"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
