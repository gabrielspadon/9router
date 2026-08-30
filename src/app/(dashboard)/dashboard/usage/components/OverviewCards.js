"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

export default function OverviewCards({ stats }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
      <Card className="flex min-w-0 flex-col gap-1 p-4">
        <span className="text-xs text-text-muted">Total Requests</span>
        <span className="metric text-lg font-semibold text-text-main">{fmt(stats.totalRequests)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 p-4">
        <span className="text-xs text-text-muted">Total Input Tokens</span>
        <span className="metric text-lg font-semibold text-text-main">{fmt(stats.totalPromptTokens)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 p-4">
        <span className="text-xs text-text-muted">Cached Tokens</span>
        <span className="metric text-lg font-semibold text-text-main">{fmt(stats.totalCachedTokens)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 p-4">
        <span className="text-xs text-text-muted">Output Tokens</span>
        <span className="metric text-lg font-semibold text-text-main">{fmt(stats.totalCompletionTokens)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 p-4">
        <span className="text-xs text-text-muted">Est. Cost</span>
        <span className="metric text-lg font-semibold text-text-main">~{fmtCost(stats.totalCost)}</span>
        <span className="text-xs text-text-muted">Estimated, not actual billing</span>
      </Card>
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
