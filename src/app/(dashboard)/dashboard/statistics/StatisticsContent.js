"use client";

import { useState, useEffect, useCallback, useMemo, useReducer } from "react";
import { useSearchParams } from "next/navigation";
import { translate, onLocaleChange } from "@/i18n/runtime";
import Badge from "@/shared/components/Badge";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  
  Legend,
} from "recharts";
import { Button, Card, EmptyState, MultiSelect, SegmentedControl, Table } from "@/shared/components";
import Pagination from "@/shared/components/Pagination";
import { fmtRate, fmtDuration, NOT_RECORDED } from "@/shared/utils/measure.js";
import { readStatsQuery, initialPeriodFor } from "./query.js";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "All" },
  { value: "custom", label: "Custom" },
];

const HOUR_MS = 3600000;
const DAY_MS = 86400000;

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

// Latency pair, total latency over time-to-first-token, e.g. 2.6s/300ms.
// Both absent is one statement about the row, not two absences side by side.
const fmtLatencyPair = (total, ttft) =>
  total == null && ttft == null
    ? NOT_RECORDED
    : `${fmtDuration(total)}/${fmtDuration(ttft)}`;

// An average is only readable next to the population it was taken over: the
// latency columns are null on rows that never measured them, so the sample
// count is almost always smaller than the request count beside it.
const latencyNote = (samples, requests) =>
  `over ${samples ?? 0} of ${requests ?? 0} requests`;

function periodRange(period) {
  const now = new Date();
  switch (period) {
    case "today": {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return { startDate: d.toISOString() };
    }
    case "24h":
      return { startDate: new Date(now.getTime() - 24 * HOUR_MS).toISOString() };
    case "7d":
      return { startDate: new Date(now.getTime() - 7 * DAY_MS).toISOString() };
    case "30d":
      return { startDate: new Date(now.getTime() - 30 * DAY_MS).toISOString() };
    default:
      return {};
  }
}

export default function StatisticsContent({ initialData }) {
  // Re-render on locale switch so explicitly-translated text (table headers,
  // which the runtime i18n skips inside <table>) updates too.
  const [, forceRender] = useReducer((x) => x + 1, 0);
  useEffect(() => onLocaleChange(forceRender), []);
  const t = translate;

  // The URL is this route's entry contract: page.js renders the first payload
  // from it. Starting the controls anywhere else makes the mount refetch ask
  // for everything and overwrite that payload, leaving chips that read "All
  // providers" above a filtered result.
  const searchParams = useSearchParams();
  const fromUrl = useMemo(() => readStatsQuery(searchParams), [searchParams]);

  const [period, setPeriod] = useState(() => initialPeriodFor(fromUrl));
  const [provider, setProvider] = useState(() => fromUrl.provider || []);
  const [account, setAccount] = useState(() => fromUrl.connectionId || []);
  const [model, setModel] = useState(() => fromUrl.model || []);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [customRange, setCustomRange] = useState(() =>
    fromUrl.startDate || fromUrl.endDate
      ? { startDate: fromUrl.startDate, endDate: fromUrl.endDate }
      : null
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Initial payload rendered server-side (see page.js): real numbers on first
  // paint; refetches keep the previous values visible instead of "…".
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState("tokens");
  const [refreshVersion, refresh] = useReducer((version) => version + 1, 0);

  const range = useMemo(() => {
    if (period === "custom") return customRange || {};
    return periodRange(period);
  }, [period, customRange]);

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (provider.length) params.set("provider", provider.join(","));
    if (account.length) params.set("connectionId", account.join(","));
    if (model.length) params.set("model", model.join(","));
    if (range.startDate) params.set("startDate", range.startDate);
    if (range.endDate) params.set("endDate", range.endDate);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    return `/api/usage/statistics?${params.toString()}`;
  }, [provider, account, model, range, page, pageSize]);

  const requestRefresh = useCallback(() => {
    setLoading(true);
    refresh();
  }, []);

  useEffect(() => {
    // The page owns the first request server-side. A client request starts only
    // after an operator changes a filter, pages the table, or explicitly refreshes.
    if (refreshVersion === 0) return undefined;
    const controller = new AbortController();
    fetch(buildUrl(), { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (!controller.signal.aborted && json) setData(json); })
      .catch((error) => {
        if (error?.name !== "AbortError") console.error("Failed to load statistics:", error);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [buildUrl, refreshVersion]);

  const resetFilters = () => {
    setProvider([]);
    setAccount([]);
    setModel([]);
    setPeriod("all");
    setCustomStart("");
    setCustomEnd("");
    setCustomRange(null);
    setPage(1);
    requestRefresh();
  };

  const applyCustomRange = () => {
    const start = customStart ? new Date(customStart) : null;
    const end = customEnd ? new Date(customEnd) : null;
    if (start && end && start.getTime() > end.getTime()) return;
    setCustomRange({
      startDate: start ? start.toISOString() : undefined,
      endDate: end ? end.toISOString() : undefined,
    });
    setPage(1);
    requestRefresh();
  };

  const filters = data?.filters || { providers: [], accounts: [], models: [] };
  const summary = data?.summary || null;
  const series = data?.series || [];
  const items = data?.items || [];
  const pagination = data?.pagination || { page: 1, pageSize, totalItems: 0, totalPages: 0 };

  const providerNameMap = useMemo(() => {
    const map = {};
    for (const p of filters.providers || []) map[p.id] = p.name;
    return map;
  }, [filters]);

  // Cascade: when providers are selected, account/model options narrow to those
  // providers' accounts/models (union across selected providers). No provider
  // selected → all options.
  const accountOptions = useMemo(() => {
    if (provider.length === 0) return (filters.accounts || []).map((a) => ({ value: a.id, label: a.name }));
    const map = new Map();
    for (const p of provider) {
      for (const a of (filters.accountsByProvider || {})[p] || []) map.set(a.id, a.name);
    }
    return [...map].map(([id, name]) => ({ value: id, label: name }));
  }, [filters, provider]);

  const modelOptions = useMemo(() => {
    if (provider.length === 0) return (filters.models || []).map((m) => ({ value: m, label: m }));
    const set = new Set();
    for (const p of provider) {
      for (const m of (filters.modelsByProvider || {})[p] || []) set.add(m);
    }
    return [...set].map((m) => ({ value: m, label: m }));
  }, [filters, provider]);

  const hasFilter = provider.length || account.length || model.length || period !== "all" || customRange;

  return (
    <div className="flex min-w-0 flex-col gap-5.5">
      {/* Filter bar */}
      <Card padding="md">
        <div className="flex flex-wrap items-end gap-3">
          <MultiSelect
            label="Provider"
            options={filters.providers.map((p) => ({ value: p.id, label: p.name }))}
            value={provider}
            onChange={(v) => {
              setProvider(v);
              // Prune accounts/models that no longer belong to the selected
              // providers (they become invalid under cascade).
              const allowedAcc = new Set(
                v.flatMap((p) => (filters.accountsByProvider || {})[p] || [])
                  .map((a) => a.id)
              );
              const allowedModel = new Set(
                v.flatMap((p) => (filters.modelsByProvider || {})[p] || [])
              );
              if (account.length && !account.every((a) => allowedAcc.has(a)))
                setAccount(account.filter((a) => allowedAcc.has(a)));
              if (model.length && !model.every((m) => allowedModel.has(m)))
                setModel(model.filter((m) => allowedModel.has(m)));
              setPage(1);
              requestRefresh();
            }}
            allLabel="All providers"
            className="w-40"
          />
          <MultiSelect
            label="Account"
            options={accountOptions}
            value={account}
            onChange={(v) => { setAccount(v); setPage(1); requestRefresh(); }}
            allLabel="All accounts"
            className="w-44"
          />
          <MultiSelect
            label="Model"
            options={modelOptions}
            value={model}
            onChange={(v) => { setModel(v); setPage(1); requestRefresh(); }}
            allLabel="All models"
            className="w-52"
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="statistics-period" className="text-sm font-medium text-text-main">Period</label>
            <select
              id="statistics-period"
              aria-label="Statistics period"
              value={period}
              onChange={(event) => { setPeriod(event.target.value); setPage(1); requestRefresh(); }}
              className="focus-ring min-h-11 rounded-[var(--radius-brand)] border border-border bg-surface px-3 text-sm text-text-main sm:hidden"
            >
              {PERIODS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <div className="hidden sm:inline-flex" role="group" aria-label="Statistics period">
              <SegmentedControl options={PERIODS} value={period} onChange={(v) => { setPeriod(v); setPage(1); requestRefresh(); }} size="sm" />
            </div>
          </div>
          {period === "custom" && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-text-main">Start</span>
                <input
                  type="datetime-local"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="focus-ring min-h-11 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text-main"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-text-main">End</span>
                <input
                  type="datetime-local"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="focus-ring min-h-11 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text-main"
                />
              </div>
              <Button
                variant="primary" size="md"
                onClick={applyCustomRange}
              >
                Apply
              </Button>
            </div>
          )}
          {hasFilter && (
            <Button
              variant="ghost" size="md"
              onClick={resetFilters}
            >
              Reset
            </Button>
          )}
          <Button
            variant="ghost"
            size="md"
            onClick={requestRefresh}
            disabled={loading}
          >
            Refresh statistics
          </Button>
        </div>
      </Card>

      {/* Summary. Nine figures given identical weight made the page a wall of
          equal numbers, most of them zero. Requests and total tokens orient the
          reader; the other seven support them and are set in a dense band.
          Every figure is still present. */}
      <div className="grid gap-px bg-border border border-border">
        <div className="grid grid-cols-1 gap-px sm:grid-cols-2">
          <StatCard lead label="Requests" value={loading ? "…" : String(summary?.totalRequests ?? 0)} />
          <StatCard lead label="Total Tokens" value={loading ? "…" : fmtTokens(summary?.totalTokens)} />
        </div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-4 xl:grid-cols-7">
          <StatCard label="Input Tokens" value={loading ? "…" : fmtTokens(summary?.inputTokens)} />
          <StatCard label="Output Tokens" value={loading ? "…" : fmtTokens(summary?.outputTokens)} />
          <StatCard label="Cache Read" value={loading ? "…" : fmtTokens(summary?.cacheReadTokens)} />
          <StatCard label="Cache Write" value={loading ? "…" : fmtTokens(summary?.cacheCreationTokens)} />
          <StatCard label="Cache Hit Rate" value={loading ? "…" : fmtRate(summary?.cacheHitRate)} />
          <StatCard
            label="Avg Response"
            value={loading ? "…" : fmtDuration(summary?.latency?.avgLatencyMs)}
            note={loading ? null : latencyNote(summary?.latency?.latencySamples, summary?.latency?.requests)}
          />
          <StatCard
            label="Avg TTFT"
            value={loading ? "…" : fmtDuration(summary?.latency?.avgTtftMs)}
            note={loading ? null : latencyNote(summary?.latency?.ttftSamples, summary?.latency?.requests)}
          />
        </div>
      </div>

      {/* Trend chart */}
      <Card
        padding="md"
        title="Trends"
        action={
          <div className="grid grid-cols-2 items-center gap-1 rounded-lg border border-border bg-surface-2 p-1">
            {["tokens", "hitRate"].map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`focus-ring hit-44 px-3 py-1 rounded-md text-sm font-medium transition-colors duration-150 cursor-pointer ${viewMode === mode ? "bg-brand-solid text-brand-on" : "text-text-muted hover:text-text-main"}`}
              >
                {mode === "tokens" ? "Tokens" : "Hit Rate"}
              </button>
            ))}
          </div>
        }
      >
        {loading ? (
          <div className="h-56 flex items-center justify-center text-text-muted text-sm">Loading…</div>
        ) : series.length === 0 ? (
          <EmptyState
            density="compact"
            className="h-56"
            title={t("No trend for this selection")}
            description={t("Nothing was recorded for this period, provider, account and model.")}
          />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                {["total", "input", "output", "cacheRead", "cacheCreate", "hitRate"].map((k) => (
                  <linearGradient key={k} id={`grad_${k}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS[k]} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={COLORS[k]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10.5, fill: "currentColor", fillOpacity: 0.5 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10.5, fill: "currentColor", fillOpacity: 0.5 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={viewMode === "tokens" ? fmtTokens : (v) => `${Math.round((v || 0) * 100)}%`}
                domain={viewMode === "tokens" ? [0, "auto"] : [0, 1]}
                width="auto"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-brand-lg)",
                  fontSize: "12.5px",
                }}
                formatter={(value, name) => {
                  const label = SERIES_LABELS[name] || name;
                  return viewMode === "tokens"
                    ? [fmtTokens(value), label]
                    : [fmtRate(value), label];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12.5 }} />
              {viewMode === "tokens" ? (
                <>
                  <Area type="monotone" dataKey="totalTokens" name="Total" stroke={COLORS.total} strokeWidth={2} fill="url(#grad_total)" dot={false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="inputTokens" name="Input" stroke={COLORS.input} strokeWidth={2} fill="url(#grad_input)" dot={false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="outputTokens" name="Output" stroke={COLORS.output} strokeWidth={2} fill="url(#grad_output)" dot={false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="cacheReadTokens" name="Cache Read" stroke={COLORS.cacheRead} strokeWidth={2} fill="url(#grad_cacheRead)" dot={false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="cacheCreationTokens" name="Cache Write" stroke={COLORS.cacheWrite} strokeWidth={2} fill="url(#grad_cacheWrite)" dot={false} activeDot={{ r: 4 }} />
                </>
              ) : (
                <Area type="monotone" dataKey="cacheHitRate" name="Hit Rate" stroke={COLORS.hitRate} strokeWidth={2} fill="url(#grad_hitRate)" dot={false} activeDot={{ r: 4 }} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Detail table */}
      <Card title="Request Details" padding="none" className="min-w-0">
        <Table
          label={t("Request Details")}
          density="configuration"
          className="text-sm min-w-[900px]"
        >
          <thead>
            {/* Token/latency cells below keep physical `text-right`: numeric
                alignment does not mirror in RTL. */}
            <tr className="border-b border-border text-start text-xs text-text-muted">
              {["Time", "Provider", "Account", "Model", "Input", "Output", "Cache Read", "Cache Write", "Hit Rate", "Time/TTFT", "Status"].map((h) => (
                <th key={h} scope="col" className="px-4 py-3 font-medium">{t(h)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-5.5">
                  <EmptyState
                    density="compact"
                    title={t("No requests match this selection")}
                    description={t("Widen the period, or clear a provider, account or model filter.")}
                  />
                </td>
              </tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className="border-b border-border last:border-b-0 hover:bg-surface-2/50">
                <td className="px-4 py-3 text-text-muted whitespace-nowrap">{fmtTime(it.timestamp)}</td>
                <td className="px-4 py-3 whitespace-nowrap">{providerNameMap[it.provider] || it.provider || "-"}</td>
                <td className="px-4 py-3 whitespace-nowrap">{it.account || "-"}</td>
                <td className="px-4 py-3 whitespace-nowrap">{it.model || "-"}</td>
                <td className="px-4 py-3 text-right metric">{fmtTokens(it.inputTokens)}</td>
                <td className="px-4 py-3 text-right metric">{fmtTokens(it.outputTokens)}</td>
                <td className="px-4 py-3 text-right metric">{fmtTokens(it.cacheReadTokens)}</td>
                <td className="px-4 py-3 text-right metric">{fmtTokens(it.cacheCreationTokens)}</td>
                <td className="px-4 py-3 text-right metric">{fmtRate(it.cacheHitRate)}</td>
                <td className="px-4 py-3 text-right metric whitespace-nowrap">{fmtLatencyPair(it.latencyMs, it.ttftMs)}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <StatusBadge status={it.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="px-4 border-t border-border">
          <Pagination
            currentPage={pagination.page}
            pageSize={pagination.pageSize}
            totalItems={pagination.totalItems}
            onPageChange={(nextPage) => { setPage(nextPage); requestRefresh(); }}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); requestRefresh(); }}
          />
        </div>
      </Card>
    </div>
  );
}

// The chart series palette lives in globals.css, not here. The legend renders
// each series name as 12px text in the series colour, so these are text colours
// with a text contrast requirement, and the raw Tailwind steps this used to
// carry failed it on the light surface. See design-system.md section 8.
const COLORS = {
  total: "var(--color-chart-1)",
  input: "var(--color-chart-2)",
  output: "var(--color-chart-3)",
  cacheRead: "var(--color-chart-4)",
  cacheWrite: "var(--color-chart-5)",
  hitRate: "var(--color-chart-6)",
};

const SERIES_LABELS = {
  totalTokens: "Total",
  inputTokens: "Input",
  outputTokens: "Output",
  cacheReadTokens: "Cache Read",
  cacheCreationTokens: "Cache Write",
  cacheHitRate: "Hit Rate",
};

// Hairlines come from the parent grid's gap, so the figures read as one
// instrument face rather than nine separate cards. A card is for a portable
// object, and a summary figure is not one.
function StatCard({ label, value, note = null, lead = false }) {
  return (
    <div className={`bg-surface ${lead ? "px-5.5 py-4" : "px-4 py-3"}`}>
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
        {label}
      </p>
      <p
        className={`metric mt-1 truncate font-semibold text-text-main ${
          lead ? "text-3xl" : "text-base"
        }`}
      >
        {value}
      </p>
      {note ? (
        <p className="mt-1 font-mono text-[10.5px] leading-3 text-text-subtle">{note}</p>
      ) : null}
    </div>
  );
}

// Request outcome. Badge supplies the glyph for the tone, so the result never
// depends on hue alone.
function StatusBadge({ status }) {
  const ok = status === "success" || status === "ok" || status === "200 OK";
  return (
    <Badge variant={ok ? "success" : "danger"} size="sm">
      {ok ? "ok" : status || "error"}
    </Badge>
  );
}

function fmtTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
