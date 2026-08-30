"use client";

/**
 * ModelAvailabilityBadge — compact inline status indicator
 *
 * Shows green when all models are operational, or amber/red when there are
 * issues, with a hover popover for details and cooldown clearing.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

// Model health maps onto the shared status tokens rather than hard-coded hex,
// so it flips with the theme. Each state keeps a distinct glyph and a label, so
// the row never depends on hue alone. See docs/design/design-system.md section 1.
const STATUS_CONFIG = {
  available: { icon: "check_circle", tone: "text-success", label: "Available" },
  cooldown: { icon: "schedule", tone: "text-warning", label: "Cooldown" },
  unavailable: { icon: "error", tone: "text-danger", label: "Unavailable" },
  unknown: { icon: "help", tone: "text-text-muted", label: "Unknown" },
};

export default function ModelAvailabilityBadge() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [clearing, setClearing] = useState(null);
  const ref = useRef(null);
  const notify = useNotificationStore();

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/models/availability");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // silent fail — will retry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Close popover on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setExpanded(false);
    };
    if (expanded) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expanded]);

  const handleClearCooldown = async (provider, model) => {
    setClearing(`${provider}:${model}`);
    try {
      const res = await fetch("/api/models/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearCooldown", provider, model }),
      });
      if (res.ok) {
        notify.success(`Cooldown cleared for ${model}`);
        await fetchStatus();
      } else {
        notify.error("Failed to clear cooldown");
      }
    } catch {
      notify.error("Failed to clear cooldown");
    } finally {
      setClearing(null);
    }
  };

  if (loading) return null;

  const models = data?.models || [];
  const unavailableCount = data?.unavailableCount || models.filter((m) => m.status !== "available").length;
  const isHealthy = unavailableCount === 0;

  // Group unhealthy models by provider
  const byProvider = {};
  models.forEach((m) => {
    if (m.status === "available") return;
    const key = m.provider || "unknown";
    if (!byProvider[key]) byProvider[key] = [];
    byProvider[key].push(m);
  });

  return (
    <div className="relative" ref={ref}>
      {/* <button
        onClick={() => setExpanded(!expanded)}
        className={`focus-ring inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors duration-150 ${
          isHealthy
            ? "bg-success-soft border-success-line text-success hover:bg-success-soft"
            : "bg-warning-soft border-warning-line text-warning hover:bg-warning-soft"
        }`}
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
          {isHealthy ? "verified" : "warning"}
        </span>
        {isHealthy
          ? "All models operational"
          : `${unavailableCount} model${unavailableCount !== 1 ? "s" : ""} with issues`}
      </button> */}

      {expanded && (
        <div className="absolute top-full right-0 mt-2 w-80 bg-surface border border-border rounded-xl shadow-elev z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-2">
            <div className="flex items-center gap-2">
              <span
                className={`material-symbols-outlined text-[16px] ${isHealthy ? "text-success" : "text-warning"}`}
                aria-hidden="true"
              >
                {isHealthy ? "verified" : "warning"}
              </span>
              <span className="text-sm font-semibold text-text-main">Model Status</span>
              <span className="sr-only">{isHealthy ? "All models available" : "Some models degraded"}</span>
            </div>
            <Button
              variant="ghost" size="icon-sm"
              onClick={fetchStatus}
              title="Refresh"
              aria-label="Refresh model status"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">refresh</span>
            </Button>
          </div>

          <div className="px-4 py-3 max-h-60 overflow-y-auto">
            {isHealthy ? (
              <p className="text-sm text-text-muted text-center py-2">
                All models are responding normally.
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {Object.entries(byProvider).map(([provider, provModels]) => (
                  <div key={provider}>
                    <p className="text-xs font-semibold text-text-main mb-1.5 capitalize">{provider}</p>
                    <div className="flex flex-col gap-1">
                      {provModels.map((m) => {
                        const status = STATUS_CONFIG[m.status] || STATUS_CONFIG.unknown;
                        const isClearing = clearing === `${m.provider}:${m.model}`;
                        return (
                          <div
                            key={`${m.provider}-${m.model}`}
                            className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface-2"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className={`material-symbols-outlined text-[14px] shrink-0 ${status.tone}`}
                                aria-hidden="true"
                              >
                                {status.icon}
                              </span>
                              <span className="sr-only">{status.label}</span>
                              <span className="font-mono text-xs text-text-main truncate" title={m.model}>{m.model}</span>
                            </div>
                            {m.status === "cooldown" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleClearCooldown(m.provider, m.model)}
                                disabled={isClearing}
                                className="text-xs px-1.5! py-0.5! ml-2"
                              >
                                {isClearing ? "..." : "Clear"}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
