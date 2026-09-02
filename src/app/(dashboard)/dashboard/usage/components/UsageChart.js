"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
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
import Card from "@/shared/components/Card";

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;

// #3163: hourly rows carry a canonical `bucketStart` instant; the `label` beside
// it was formatted in the SERVER's zone, so binding the axis to it showed a
// viewer hours that were not theirs. Format from the instant instead, in the
// viewer's own zone. Day-period rows (and anything predating the field) have no
// usable instant and keep their label verbatim. Locale stays en-US so only the
// zone moves; a dateKey string, which the `all` branch aliases as bucketStart in
// SQL, is not an instant and must not reach `new Date`.
export function formatBucketTick(row) {
  const ts = row?.bucketStart;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return row?.label ?? "";
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export default function UsageChart({ period = "7d", refreshKey = 0 }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("tokens");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/usage/chart?period=${period}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("Failed to fetch chart data:", e);
    } finally {
      setLoading(false);
    }
  }, [period, refreshKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const hasData = data.some((d) => d.tokens > 0 || d.cost > 0);
  // Memoised so toggling tokens/cost does not hand recharts a new array and
  // replay the entry animation.
  const rows = useMemo(() => data.map((d) => ({ ...d, tick: formatBucketTick(d) })), [data]);

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
      <div className="grid w-full grid-cols-2 items-center gap-1 rounded-lg border border-border bg-surface-2 p-1 sm:w-auto sm:self-start">
        <button
          onClick={() => setViewMode("tokens")}
          className={`focus-ring hit-44 px-3 py-1 rounded-md text-sm font-medium transition-colors duration-150 ${viewMode === "tokens" ? "bg-brand-solid text-brand-on" : "text-text-muted hover:text-text-main hover:bg-surface-2"}`}
        >
          Tokens
        </button>
        <button
          onClick={() => setViewMode("cost")}
          className={`focus-ring hit-44 px-3 py-1 rounded-md text-sm font-medium transition-colors duration-150 ${viewMode === "cost" ? "bg-brand-solid text-brand-on" : "text-text-muted hover:text-text-main hover:bg-surface-2"}`}
        >
          Cost
        </button>
      </div>

      {loading ? (
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">Loading...</div>
      ) : !hasData ? (
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">No data for this period</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            {/* Series colours come from the chart token scale, not raw palette
                steps: amber-500 drew the cost line at 1.8:1 on the light ground,
                under the 3:1 a 2px stroke needs to be seen at all. See the
                --color-chart-* tokens in src/app/globals.css. */}
            <defs>
              <linearGradient id="gradTokens" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-chart-2)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="var(--color-chart-2)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-chart-6)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="var(--color-chart-6)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
            <XAxis
              dataKey="tick"
              tick={{ fontSize: 10.5, fill: "currentColor", fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10.5, fill: "currentColor", fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={viewMode === "tokens" ? fmtTokens : fmtCost}
              width="auto"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-brand-lg)",
                fontSize: "12.5px",
              }}
              formatter={(value, name) =>
                name === "tokens" ? [fmtTokens(value), "Tokens"] : [fmtCost(value), "Cost"]
              }
            />
            {viewMode === "tokens" ? (
              <Area
                type="monotone"
                dataKey="tokens"
                stroke="var(--color-chart-2)"
                strokeWidth={2}
                fill="url(#gradTokens)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            ) : (
              <Area
                type="monotone"
                dataKey="cost"
                stroke="var(--color-chart-6)"
                strokeWidth={2}
                fill="url(#gradCost)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

UsageChart.propTypes = {
  period: PropTypes.string,
  refreshKey: PropTypes.number,
};
