"use client";

import PropTypes from "prop-types";
import { translate } from "@/i18n/runtime";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

// Every label goes through `translate`, because a string that never reaches it
// can never be translated at all: the locale files are keyed by the English
// source text. This grid rendered entirely in English in all five locales.
//
// direction.md:95, "Cards are reserved for portable objects. Sections are
// separated by rule, band and inset instead." These five are readouts of one
// period, not five objects that can be moved, opened or deleted, so they are
// one banded row divided by rules rather than five floating rectangles. Same
// composition as the system masthead, which answers the same kind of question.
export default function OverviewCards({ stats, periodLabel = "" }) {
  return (
    <div className="grid min-w-0 grid-cols-2 border-y border-border sm:grid-cols-3 lg:grid-cols-5">
      <div className="flex min-w-0 flex-col gap-1 border-border px-3 py-2 sm:px-5.5 sm:py-3 [&:not(:last-child)]:border-e">
        <span className="text-xs text-text-muted">{translate("Total Requests")}</span>
        <span className="metric text-lg font-semibold text-text-main">{fmt(stats.totalRequests)}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-1 border-border px-3 py-2 sm:px-5.5 sm:py-3 [&:not(:last-child)]:border-e">
        <span className="text-xs text-text-muted">{translate("Total Input Tokens")}</span>
        <span className="metric text-lg font-semibold text-text-main">{fmt(stats.totalPromptTokens)}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-1 border-border px-3 py-2 sm:px-5.5 sm:py-3 [&:not(:last-child)]:border-e">
        <span className="text-xs text-text-muted">{translate("Cached Tokens")}</span>
        <span className="metric text-lg font-semibold text-text-main">{fmt(stats.totalCachedTokens)}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-1 border-border px-3 py-2 sm:px-5.5 sm:py-3 [&:not(:last-child)]:border-e">
        <span className="text-xs text-text-muted">{translate("Output Tokens")}</span>
        <span className="metric text-lg font-semibold text-text-main">{fmt(stats.totalCompletionTokens)}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-1 border-border px-3 py-2 sm:px-5.5 sm:py-3 [&:not(:last-child)]:border-e">
        <span className="text-xs text-text-muted">{translate("Est. Cost")}</span>
        <span className="metric text-lg font-semibold text-text-main">~{fmtCost(stats.totalCost)}</span>
        {/* The masthead already shows Spend over its own rolling window. Without
            the period named here, two different cost figures sit on one screen
            reading as the same number disagreeing with itself. */}
        <span className="text-xs text-text-muted">
          {translate("Estimated, not actual billing")}
          {periodLabel ? ` · ${periodLabel}` : ""}
        </span>
      </div>
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
  periodLabel: PropTypes.string,
};
