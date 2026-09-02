"use client";

import { useState, useEffect } from "react";
import Card from "@/shared/components/Card";
import { fmt } from "./UsageTable";

// Auto-update relative time / duration displays every second without
// re-rendering the parent (UsageStats).
function useTickEverySecond() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
}

function timeAgo(timestamp) {
  if (!timestamp) return "—";
  const diff = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtDuration(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m${rem}s`;
}

const PANEL_TABS = [
  { value: "recent", label: "Recent Requests" },
  { value: "sessions", label: "Sessions" },
];

/**
 * Tabbed card that occupies the slot the standalone Recent Requests panel held.
 * Tab 1: Recent Requests (per-request tallies from the usage ring).
 * Tab 2: Sessions (in-flight + just-finished requests with client id, model,
 *        and the in/out tokens back-filled on completion).
 *
 * @param {object} props
 * @param {Array}  props.recentRequests - stats.recentRequests
 * @param {Array}  props.activeSessions - stats.activeSessions
 */
export default function RequestsPanel({ recentRequests = [], activeSessions = [] }) {
  const [tab, setTab] = useState("recent");
  useTickEverySecond();

  return (
    <Card className="flex min-w-0 flex-col overflow-hidden" padding="sm" style={{ height: 480 }}>
      <div className="flex items-center justify-between gap-2 px-1 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1">
          {PANEL_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              aria-pressed={tab === t.value}
              className={`rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${
                tab === t.value
                  ? "bg-brand-solid text-brand-on"
                  : "text-text-muted hover:bg-surface-2 hover:text-text-main"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "sessions" && (
          <span className="font-mono text-[11px] text-text-muted whitespace-nowrap">
            {activeSessions.filter((s) => s.status === "active").length} active
          </span>
        )}
      </div>

      {tab === "recent" ? (
        <RecentRequestsView requests={recentRequests} />
      ) : (
        <SessionsView sessions={activeSessions} />
      )}
    </Card>
  );
}

function RecentRequestsView({ requests = [] }) {
  if (!requests.length) {
    return <div className="flex-1 flex items-center justify-center text-text-muted text-sm">No requests yet.</div>;
  }
  return (
    <div className="flex-1 overflow-y-auto">
      {/* Numeric columns below keep physical `text-right`: digits are an
          LTR run, so they stay right-aligned in RTL too. Do not convert. */}
      <table className="metric w-full min-w-[300px] border-collapse text-xs">
        <thead className="sticky top-0 bg-bg z-10">
          <tr className="border-b border-border">
            <th className="py-1.5 text-start font-semibold text-text-muted w-2"></th>
            <th className="py-1.5 text-start font-semibold text-text-muted">Model</th>
            <th className="py-1.5 text-start font-semibold text-text-muted hidden sm:table-cell">Key</th>
            <th className="py-1.5 text-right font-semibold text-text-muted">In / Out</th>
            <th className="py-1.5 text-right font-semibold text-text-muted">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {requests.map((r, i) => {
            const ok = !r.status || r.status === "ok" || r.status === "success";
            return (
              <tr key={i} className="hover:bg-surface-2 transition-colors">
                <td className="py-1.5">
                  <span role="img" aria-label={ok ? "Succeeded" : "Failed"} title={ok ? "Succeeded" : "Failed"} className={`block w-1.5 h-1.5 rounded-full ${ok ? "bg-success" : "bg-danger"}`} />
                </td>
                <td className="py-1.5 font-mono truncate max-w-[120px]" title={r.model}>{r.model}</td>
                <td className="py-1.5 font-mono text-text-muted truncate max-w-[90px] hidden sm:table-cell" title={r.apiKey || "No key (loopback)"}>
                  {r.apiKey || "—"}
                </td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  <span className="text-brand">{fmt(r.promptTokens)}↑</span>
                  {" "}
                  <span className="text-success">{fmt(r.completionTokens)}↓</span>
                </td>
                <td className="py-1.5 text-right text-text-muted whitespace-nowrap">{timeAgo(r.timestamp)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Ended (done / error) rows stay visible this long so the user can read the
// final in/out tally, then drop out. Active rows always show.
const ENDED_VISIBILITY_MS = 15 * 1000;

// Read the clock outside the component body: the parent's one-second tick is
// what re-evaluates this, and an inline Date.now() in render trips
// react-hooks/purity (same reason timeAgo above is a module-level helper).
function isStillVisible(s) {
  if (s.status === "active") return true;
  if (!s.completedAt) return true; // not stamped yet — keep until we know
  return Date.now() - s.completedAt < ENDED_VISIBILITY_MS;
}

function SessionsView({ sessions = [] }) {
  const visible = sessions.filter(isStillVisible);

  if (!visible.length) {
    return <div className="flex-1 flex items-center justify-center text-text-muted text-sm">No active sessions.</div>;
  }
  return (
    <div className="flex-1 overflow-y-auto">
      {/* Numeric column keeps physical `text-right`: see RecentRequestsView. */}
      <table className="metric w-full min-w-[320px] border-collapse text-xs">
        <thead className="sticky top-0 bg-bg z-10">
          <tr className="border-b border-border">
            <th className="py-1.5 text-start font-semibold text-text-muted w-2"></th>
            <th className="py-1.5 text-start font-semibold text-text-muted">Client IP</th>
            <th className="py-1.5 text-start font-semibold text-text-muted">Model</th>
            <th className="py-1.5 text-right font-semibold text-text-muted whitespace-nowrap">In / Out</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {visible.map((s) => {
            const isActive = s.status === "active";
            const isError = s.status === "error";
            const dot = isError ? "bg-danger" : isActive ? "bg-brand-solid animate-pulse" : "bg-success";
            const label = isError ? "Failed" : isActive ? "In flight" : "Finished";
            const hasTokens = !(s.promptTokens == null && s.completionTokens == null);
            return (
              <tr key={s.requestId} className="hover:bg-surface-2 transition-colors">
                <td className="py-1.5">
                  <span role="img" aria-label={label} title={`${label} · ${fmtDuration(s.durationMs)}`} className={`block w-1.5 h-1.5 rounded-full ${dot}`} />
                </td>
                <td className="py-1.5 font-mono truncate max-w-[110px]" title={s.clientId}>{s.clientId}</td>
                <td className="py-1.5 font-mono truncate max-w-[140px]" title={`${s.model} · ${s.provider}${s.account ? ` · ${s.account}` : ""}`}>{s.model}</td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  {hasTokens ? (
                    <>
                      <span className="text-brand">{fmt(s.promptTokens)}↑</span>
                      {" "}
                      <span className="text-success">{fmt(s.completionTokens)}↓</span>
                    </>
                  ) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
