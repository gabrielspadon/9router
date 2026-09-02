"use client";

import { cn } from "@/shared/utils/cn";
import StatusToken from "@/shared/components/StatusToken";
import { fmtPercent } from "@/shared/utils/measure.js";
import { formatResetTime } from "./utils";

// Bands this dashboard applies locally to the remaining share the provider
// reported — above 70%, 30 to 70, below 30 — not a health verdict any upstream
// issued, so no band carries a word of its own and the token states the share.
// null is a total that was never reported, which belongs in no band.
const getColorClasses = (remainingPercentage) => {
  if (remainingPercentage === null || remainingPercentage === undefined) {
    return { tone: "idle", text: "text-text-muted", bg: "bg-border", bgLight: "bg-surface-2", icon: "help" };
  }

  if (remainingPercentage > 70) {
    return { tone: "ok", text: "text-success", bg: "bg-success-solid", bgLight: "bg-success-soft", icon: "check_circle" };
  }

  if (remainingPercentage >= 30) {
    return { tone: "degraded", text: "text-warning", bg: "bg-warning-solid", bgLight: "bg-warning-soft", icon: "warning" };
  }

  // 0-29% including a measured 0% (out of quota)
  return { tone: "failing", text: "text-danger", bg: "bg-danger-solid", bgLight: "bg-danger-soft", icon: "error" };
};

// Format reset time display
const formatResetTimeDisplay = (resetTime) => {
  if (!resetTime) return null;
  
  try {
    const resetDate = new Date(resetTime);
    const now = new Date();
    const isToday = resetDate.toDateString() === now.toDateString();
    const isTomorrow = resetDate.toDateString() === new Date(now.getTime() + 86400000).toDateString();
    
    const timeStr = resetDate.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    
    if (isToday) return `Today, ${timeStr}`;
    if (isTomorrow) return `Tomorrow, ${timeStr}`;
    
    return resetDate.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return null;
  }
};

export default function QuotaProgressBar({
  percentage = null,
  label = "",
  used = 0,
  total = 0,
  unlimited = false,
  resetTime = null,
  recurring = true,
}) {
  const colors = getColorClasses(percentage);
  const countdown = formatResetTime(resetTime);
  const resetDisplay = formatResetTimeDisplay(resetTime);

  // recurring defaults true. One-shot packs (e.g. CodeBuddy CN bonus packs)
  // set recurring:false: resetTime is a hard expiry, so word it as "expires".
  const resetWord = recurring ? "Reset" : "Expires";

  // percentage is already remaining percentage (from ProviderLimitCard)
  const remaining = percentage;
  
  return (
    <div className="space-y-2">
      {/* Label and percentage */}
      <div className="flex items-start justify-between gap-4 text-sm">
        <span className="min-w-0 font-semibold text-text-main">
          {label}
        </span>
        <StatusToken tone={colors.tone} className="shrink-0">
          {fmtPercent(remaining)} left
        </StatusToken>
      </div>

      {/* Progress bar. An unknown share has no width to draw. */}
      {!unlimited && remaining !== null && (
        <div
          /* A single rule with a filled portion, not a rounded pill: the pill
             read as an ornament sitting on the page, and the filled portion has
             to read as material. The track is the inset ground for the same
             reason. */
          className={cn("h-1.5 overflow-hidden bg-surface-3", colors.bgLight)}
          role="progressbar"
          aria-valuenow={Math.min(remaining, 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label || "Quota remaining"}
        >
          <div
            className={cn("h-full transition-[width] duration-150", colors.bg)}
            style={{ width: `${Math.min(remaining, 100)}%` }}
          />
        </div>
      )}

      {/* Usage details and countdown */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-text-muted">
        <span>
          <span className="metric">{used.toLocaleString()} / {total.toLocaleString()}</span> requests
        </span>
        {countdown !== "-" && (
          <div className="flex items-center gap-1">
            <span aria-hidden="true">•</span>
            <span className="font-medium">{resetWord} in <span className="metric">{countdown}</span></span>
          </div>
        )}
      </div>

      {/* Reset time display */}
      {resetDisplay && (
        <div className="text-xs text-text-subtle">
          {resetWord} at <span className="metric">{resetDisplay}</span>
        </div>
      )}
    </div>
  );
}
