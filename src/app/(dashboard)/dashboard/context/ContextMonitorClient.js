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

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/context-status", {
        headers: { "Cache-Control": "no-store" },
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
    const tick = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/context-status", {
          headers: { "Cache-Control": "no-store" },
        });
        if (cancelled) return;
        if (!res.ok) {
          setStatus("unavailable");
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setEntries(Array.isArray(data.entries) ? data.entries : []);
        setGeneratedAt(data.generatedAt ?? null);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
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
