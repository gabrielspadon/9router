"use client";

import { cn } from "@/shared/utils/cn";
import { formatResetTime } from "./utils";

// Quota headroom is a status, not decoration: healthy above 70% remaining,
// degraded between 30 and 70, exhausted below 30. Each band pairs its token
// with a distinct icon shape, so the state survives greyscale.
const getColorClasses = (remainingPercentage) => {
  if (remainingPercentage > 70) {
    return {
      text: "text-success",
      bg: "bg-success-solid",
      bgLight: "bg-success-soft",
      icon: "check_circle",
      state: "Healthy"
    };
  }
  
  if (remainingPercentage >= 30) {
    return {
      text: "text-warning",
      bg: "bg-warning-solid",
      bgLight: "bg-warning-soft",
      icon: "warning",
      state: "Low"
    };
  }
  
  // 0-29% including 0% (out of quota) - show danger
  return {
    text: "text-danger",
    bg: "bg-danger-solid",
    bgLight: "bg-danger-soft",
    icon: "error",
    state: "Critical"
  };
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
  percentage = 0,
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
        <div className={cn("flex shrink-0 items-center gap-1.5", colors.text)}>
          <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">
            {colors.icon}
          </span>
          <span className="metric font-medium">
            {remaining}%
          </span>
          <span className="sr-only">{colors.state}</span>
        </div>
      </div>

      {/* Progress bar */}
      {!unlimited && (
        <div
          className={cn("h-2 rounded-full overflow-hidden", colors.bgLight)}
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
