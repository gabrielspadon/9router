"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, Button } from "@/shared/components";

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

const fmtUptime = (ms) => {
  if (!ms || ms <= 0) return "—";
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};

const WINDOW_TABS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7d", label: "7 days" },
  { id: "last30d", label: "30 days" },
  { id: "all", label: "All time" },
];

const REASON_LABELS = {
  applied: "Prompt exceeded threshold",
  below_threshold: "Below size threshold",
  not_profitable: "Compression not profitable",
  below_min_chars: "Below minimum chars",
  below_min_tokens: "Below minimum tokens",
  unsupported_model: "Model not in allowlist",
  unsupported_format: "Non-Claude request format",
  timeout: "Compression timed out",
  transform_error: "Transform error",
  passthrough: "Passthrough",
  disabled: "Disabled",
  not_installed: "Not installed",
};

// Status vocabulary per .unlazy/TOKEN-CONTRACT.md section 1. A request that
// simply did not qualify for compression is a neutral notice, not a warning;
// only a missing or switched-off module is degraded, and only a crash failed.
const FAILED_REASONS = new Set(["transform_error", "timeout"]);
const DEGRADED_REASONS = new Set(["not_installed", "disabled"]);

function SummaryCard({ label, value, sub, tone }) {
  return (
    <Card padding="sm">
      <p className="text-xs text-text-muted">{label}</p>
      <p className={`text-lg font-semibold mt-1 metric ${tone || "text-text-main"}`}>{value}</p>
      {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
    </Card>
  );
}

export default function PxpipeClient() {
  const [status, setStatus] = useState(null);
  const [health, setHealth] = useState(null);
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState(null);
  const [windowId, setWindowId] = useState("last7d");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, statsRes, logsRes] = await Promise.all([
        fetch("/api/pxpipe/status", { headers: { "Cache-Control": "no-store" } }),
        fetch("/api/pxpipe/stats"),
        fetch("/api/pxpipe/logs?limit=50"),
      ]);
      setStatus(await statusRes.json());
      setStats(await statsRes.json());
      setLogs(await logsRes.json());
      const healthRes = await fetch("/api/pxpipe/health", { method: "POST" });
      setHealth(await healthRes.json());
    } catch {
      /* sections render placeholders */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const w = stats?.windows?.[windowId];
  const statusLabel = !status
    ? "—"
    : !status.installed
      ? "Not installed"
      : health?.healthy
        ? "Healthy"
        : status.running
          ? "Running"
          : "Stopped";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-lg font-semibold text-text-main flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-text-muted" aria-hidden="true">image</span>
          PXPIPE Dashboard
        </h2>
        <div className="flex items-center gap-2">
          <a href="/dashboard/token-saver" className="focus-ring rounded-sm text-xs text-brand underline hover:no-underline">
            Token Saver settings
          </a>
          <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <SummaryCard
          label="Status"
          value={statusLabel}
          tone={health?.healthy ? "text-success" : status?.installed ? "text-warning" : "text-text-muted"}
          sub={status?.enabled ? "Enabled in pipeline" : "Disabled in pipeline"}
        />
        <SummaryCard label="Version" value={status?.version ? `v${status.version}` : "—"} sub="pxpipe-proxy" />
        <SummaryCard label="Uptime" value={fmtUptime(status?.uptimeMs)} sub="module loaded" />
        <SummaryCard label="Requests" value={w ? w.requests.toLocaleString() : "—"} />
        <SummaryCard label="Compressed" value={w ? w.compressed.toLocaleString() : "—"} />
        <SummaryCard label="Bypassed" value={w ? w.bypassed.toLocaleString() : "—"} />
      </div>

      <Card>
        <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
          <h3 className="text-sm font-semibold text-text-main">Token savings (estimated)</h3>
          <div className="flex items-center gap-1 rounded-[var(--radius-brand)] border border-border bg-surface-2 p-1">
            {WINDOW_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setWindowId(tab.id)}
                aria-pressed={windowId === tab.id}
                className={`focus-ring px-3 py-1 rounded-[8px] text-xs font-medium transition-colors duration-150 ${
                  windowId === tab.id
                    ? "bg-brand-solid text-brand-on"
                    : "text-text-muted hover:text-text-main hover:bg-surface-3"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-xs text-text-muted">Original tokens</p>
            <p className="text-lg font-semibold text-text-main metric">{w ? fmtTokens(w.tokensBeforeEst) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">After PXPIPE</p>
            <p className="text-lg font-semibold text-text-main metric">{w ? fmtTokens(w.tokensAfterEst) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Saved</p>
            <p className="text-lg font-semibold text-text-main metric">{w ? fmtTokens(w.tokensSavedEst) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Reduction</p>
            <p className="text-lg font-semibold text-text-main metric">{w ? `${w.savedPct}%` : "—"}</p>
          </div>
        </div>
        <p className="text-xs text-text-muted mt-4">
          Estimates from body size before/after imaging; billed usage per request
          (recorded on the Usage page) remains the ground truth. Images generated:{" "}
          <span className="metric">{w ? w.imagesGenerated.toLocaleString() : "—"}</span> · avg compression time:{" "}
          <span className="metric">{w ? `${w.avgCompressionMs}ms` : "—"}</span> · errors: <span className="metric">{w ? w.errors : "—"}</span>
        </p>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-text-main mb-4">Tokens saved — last 30 days</h3>
        {stats?.timeline?.some((d) => d.tokensSavedEst > 0) ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={stats.timeline} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradPxpipe" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-brand-500)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--color-brand-500)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={fmtTokens} width={48} />
              <Tooltip formatter={(v) => [fmtTokens(v), "Tokens saved"]} labelFormatter={(d) => d} />
              <Area type="monotone" dataKey="tokensSavedEst" stroke="var(--color-brand-500)" fill="url(#gradPxpipe)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-32 flex items-center justify-center text-text-muted text-sm">
            No savings recorded yet — enable PXPIPE in the Token Saver and route a large Claude-format request.
          </div>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-text-main mb-4">History</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted border-b border-border">
                <th scope="col" className="px-4 py-3 font-medium">Time</th>
                <th scope="col" className="px-4 py-3 font-medium">Model</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Original</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Compressed</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Saved</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">%</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Duration</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.recent || []).slice(0, 50).map((ev, i) => (
                <tr key={`${ev.ts}-${i}`} className="border-b border-border-subtle">
                  <td className="px-4 py-3 whitespace-nowrap text-text-muted">
                    {new Date(ev.ts).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-main">{ev.provider ? `${ev.provider}/${ev.model}` : ev.model || "—"}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-text-main metric">
                    {ev.applied ? fmtTokens(ev.tokensBeforeEst) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-text-main metric">
                    {ev.applied ? fmtTokens(ev.tokensAfterEst) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-text-main metric">
                    {ev.applied ? fmtTokens(ev.tokensSavedEst) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-text-main metric">
                    {ev.applied ? `${ev.savedPct}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-text-main metric">
                    {ev.durationMs != null ? `${ev.durationMs}ms` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-[var(--radius-brand)] border ${
                        ev.applied
                          ? "bg-success-soft border-success-line text-success"
                          : FAILED_REASONS.has(ev.reason)
                            ? "bg-danger-soft border-danger-line text-danger"
                            : DEGRADED_REASONS.has(ev.reason)
                              ? "bg-warning-soft border-warning-line text-warning"
                              : "bg-info-soft border-info-line text-info"
                      }`}
                      title={ev.detail || ""}
                    >
                      <span className="material-symbols-outlined text-[12px]" aria-hidden="true">
                        {ev.applied
                          ? "check_circle"
                          : FAILED_REASONS.has(ev.reason)
                            ? "error"
                            : DEGRADED_REASONS.has(ev.reason)
                              ? "warning"
                              : "info"}
                      </span>
                      {ev.applied ? "Compressed" : REASON_LABELS[ev.reason] || ev.reason}
                    </span>
                  </td>
                </tr>
              ))}
              {(!stats?.recent || stats.recent.length === 0) && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-text-muted text-sm">
                    No PXPIPE activity yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card id="logs">
        <h3 className="text-sm font-semibold text-text-main mb-4">PXPIPE Logs</h3>
        {logs?.installLog ? (
          <pre tabIndex={0} aria-label="PXPIPE install log" className="focus-ring rounded-[var(--radius-brand)] bg-surface-2 text-text-main p-4 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
            {logs.installLog}
          </pre>
        ) : (
          <p className="text-sm text-text-muted">No install log yet.</p>
        )}
      </Card>
    </div>
  );
}
