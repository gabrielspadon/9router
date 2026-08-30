"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "@/shared/components/Button";
import { formatResetTime, getRemainingPercentage } from "./utils";

const PAGE_SIZE = 10;

/**
 * Format reset time display (Today, 12:00 PM)
 */
function formatResetTimeDisplay(resetTime) {
  if (!resetTime) return null;

  try {
    const date = new Date(resetTime);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let dayStr = "";
    if (date >= today && date < tomorrow) {
      dayStr = "Today";
    } else if (date >= tomorrow && date < new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)) {
      dayStr = "Tomorrow";
    } else {
      dayStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    return `${dayStr}, ${timeStr}`;
  } catch {
    return null;
  }
}

/**
 * Map remaining headroom onto the shared status tokens. Healthy above 70%,
 * degraded between 30 and 70, exhausted below 30. Each band carries a distinct
 * icon shape so the row is readable without relying on hue.
 */
function getColorClasses(remainingPercentage) {
  if (remainingPercentage > 70) {
    return {
      text: "text-success",
      bg: "bg-success-solid",
      bgLight: "bg-success-soft",
      icon: "check_circle",
      state: "Healthy",
    };
  }

  if (remainingPercentage >= 30) {
    return {
      text: "text-warning",
      bg: "bg-warning-solid",
      bgLight: "bg-warning-soft",
      icon: "warning",
      state: "Low",
    };
  }

  return {
    text: "text-danger",
    bg: "bg-danger-solid",
    bgLight: "bg-danger-soft",
    icon: "error",
    state: "Critical",
  };
}

function sortQuotas(quotas, sortMode) {
  if (sortMode === "remaining-asc") {
    return [...quotas].sort((a, b) => a.remaining - b.remaining || a.name.localeCompare(b.name));
  }

  if (sortMode === "remaining-desc") {
    return [...quotas].sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name));
  }

  return quotas;
}

/**
 * Quota Table Component - Table-based display for quota data
 */
export default function QuotaTable({
  quotas = [],
  compact = false,
  sortMode = "default",
  showSortLabel = false,
  onHideQuota = null,
}) {
  const [page, setPage] = useState(1);

  const normalizedQuotas = useMemo(
    () => quotas.map((quota, index) => ({
      ...quota,
      index,
      remaining: getRemainingPercentage(quota),
    })),
    [quotas],
  );

  const sortedQuotas = useMemo(
    () => sortQuotas(normalizedQuotas, sortMode),
    [normalizedQuotas, sortMode],
  );

  const totalPages = Math.max(1, Math.ceil(sortedQuotas.length / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [sortMode, quotas]);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  if (!quotas || quotas.length === 0) {
    return null;
  }

  const currentPageRows = sortedQuotas.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );
  const pageStart = sortedQuotas.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PAGE_SIZE, sortedQuotas.length);

  // Currency rows (unit:"USD") render a dollar value instead of a percentage.
  const isCurrency = (quota) => quota.unit === "USD";
  const formatCurrency = (value) => {
    const num = Number(value) || 0;
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const cellPad = compact ? "py-2 px-3" : "py-3 px-4";
  const nameText = compact ? "text-xs" : "text-sm";
  const resetPrimary = compact ? "text-xs" : "text-sm";
  const resetSecondary = compact ? "text-xs leading-tight" : "text-xs";
  const sortLabel = "Sorted by account remaining";
  const hasHideAction = typeof onHideQuota === "function";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-text-muted">
          <span className="metric">{sortedQuotas.length}</span> quota{sortedQuotas.length > 1 ? "s" : ""}
        </div>
        {showSortLabel && (
          <div className="rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-text-muted">
            {sortLabel}
          </div>
        )}
      </div>

      <div className="space-y-px">
        {currentPageRows.map((quota) => {
          const colors = getColorClasses(quota.remaining);
          const countdown = formatResetTime(quota.resetAt);
          const resetDisplay = formatResetTimeDisplay(quota.resetAt);
          // recurring defaults true: a missing flag means the quota
          // refreshes at resetAt. Bonus/one-shot packs set recurring:false
          // and their resetAt is a hard expiry, so word it as "expires".
          const recurring = quota.recurring !== false;
          const countdownLabel = recurring ? `in ${countdown}` : `expires in ${countdown}`;

          return (
            <div
              key={`${quota.name}-${quota.index}`}
              className={`flex items-center gap-2 border-b border-border hover:bg-surface-2 transition-colors duration-150 ${cellPad}`}
            >
              {/* Name */}
              <div className="flex w-36 min-w-0 items-center gap-1.5">
                <span
                  className={`material-symbols-outlined shrink-0 text-[14px] leading-none ${colors.text}`}
                  aria-hidden="true"
                >
                  {colors.icon}
                </span>
                <span className="sr-only">{colors.state}</span>
                <span className={`${nameText} font-medium text-text-main truncate`} title={quota.name}>
                  {quota.name}
                </span>
              </div>

              {/* Progress + used/total */}
              <div className={`min-w-0 flex-1 ${compact ? "space-y-1" : "space-y-1.5"}`}>
                {isCurrency(quota) ? (
                  <div className="flex items-center justify-between gap-1 min-w-0 text-xs">
                    <span className="text-text-muted truncate">
                      {quota.plan ? quota.plan : "Balance"}
                    </span>
                    <span className={`metric font-medium ${colors.text} shrink-0`}>
                      {formatCurrency(quota.remaining)}
                    </span>
                  </div>
                ) : (
                  <>
                    <div
                      className={`${compact ? "h-1" : "h-1.5"} rounded-full overflow-hidden border ${colors.bgLight} ${
                        quota.remaining === 0 ? "border-border" : "border-transparent"
                      }`}
                      role="progressbar"
                      aria-valuenow={Math.min(quota.remaining, 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={quota.name}
                    >
                      <div
                        className={`h-full transition-[width] duration-150 ${colors.bg}`}
                        style={{ width: `${Math.min(quota.remaining, 100)}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-1 min-w-0 text-xs">
                      <span
                        className="metric text-text-muted truncate"
                        title={`${quota.used.toLocaleString()} / ${quota.total > 0 ? quota.total.toLocaleString() : "∞"}`}
                      >
                        {quota.used.toLocaleString()} / {quota.total > 0 ? quota.total.toLocaleString() : "∞"}
                      </span>
                      <span className={`metric font-medium ${colors.text} shrink-0`}>
                        {quota.remaining}%
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Reset time */}
              <div className="min-w-0 shrink">
                {quota.unlimited ? (
                  <div className={`${resetPrimary} text-text-muted italic`}>Never expires</div>
                ) : countdown !== "-" || resetDisplay ? (
                  compact ? (
                    <div
                      className={`${resetPrimary} metric text-text-main font-medium truncate`}
                      title={resetDisplay || ""}
                    >
                      {countdown !== "-" ? countdownLabel : resetDisplay}
                    </div>
                  ) : (
                    <div className="min-w-0 space-y-0.5">
                      {countdown !== "-" && (
                        <div className={`${resetPrimary} metric text-text-main font-medium truncate`}>
                          {countdownLabel}
                        </div>
                      )}
                      {resetDisplay && (
                        <div className={`${resetSecondary} metric text-text-muted truncate`}>
                          {resetDisplay}
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  <div className={`${resetPrimary} text-text-muted italic`}>N/A</div>
                )}
              </div>

              {/* Hide action */}
              {hasHideAction && (
                <Button
                  variant="ghost" size="icon-sm"
                  type="button"
                  onClick={() => onHideQuota(quota)}
                  className="shrink-0"
                  title="Hide this quota row"
                  aria-label={`Hide quota ${quota.name}`}
                >
                  <span className="material-symbols-outlined text-[15px]" aria-hidden="true">
                    visibility_off
                  </span>
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="rounded-md border border-border bg-surface-2 px-2 py-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
            <span>
              Showing <span className="metric">{pageStart}-{pageEnd}</span> of{" "}
              <span className="metric">{sortedQuotas.length}</span>
            </span>
            <span>
              Page <span className="metric">{page} / {totalPages}</span>
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-end gap-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
              disabled={page === 1}
            >
              Prev
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
              disabled={page === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
