"use client";

import { useState, useEffect, useRef } from "react";
import { getStatusVariant as getConnectionStatusVariant } from "@/shared/utils/connectionStatus";
import PropTypes from "prop-types";
import { Badge, Button, Toggle, Tooltip } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import CooldownTimer from "./CooldownTimer";

const HOT_RELOAD_BADGE_VARIANTS = {
  queued: "default",
  testing: "primary",
  success: "success",
  failed: "error",
  partial: "warning",
};

export function getPersistedCodexPlan(connection) {
  if (connection?.provider !== "codex") return null;

  const candidates = [
    connection.providerSpecificData?.codexSubscriptionPlan,
    connection.providerSpecificData?.chatgptPlanType,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const plan = candidate.trim();
    if (plan && plan.toLowerCase() !== "unknown") return plan;
  }
  return null;
}

export default function ConnectionRow({ connection, proxyPools, isOAuth, isFirst, isLast, onMoveUp, onMoveDown, onToggleActive, onUpdateProxy, onEdit, onDelete, oneByOneStatus = null, autoPing = null, hotReload = null, hotReloadStatus = null, verification = null }) {
  const [showProxyDropdown, setShowProxyDropdown] = useState(false);
  const [updatingProxy, setUpdatingProxy] = useState(false);
  const proxyDropdownRef = useRef(null);

  const proxyPoolMap = new Map((proxyPools || []).map((pool) => [pool.id, pool]));
  const boundProxyPoolId = connection.providerSpecificData?.proxyPoolId || null;
  const boundProxyPool = boundProxyPoolId ? proxyPoolMap.get(boundProxyPoolId) : null;
  const hasLegacyProxy = connection.providerSpecificData?.connectionProxyEnabled === true && !!connection.providerSpecificData?.connectionProxyUrl;
  const hasAnyProxy = !!boundProxyPoolId || hasLegacyProxy;
  const proxyDisplayText = boundProxyPool
    ? `Pool: ${boundProxyPool.name}`
    : boundProxyPoolId
      ? `Pool: ${boundProxyPoolId} (inactive/missing)`
      : hasLegacyProxy
        ? `Legacy: ${connection.providerSpecificData?.connectionProxyUrl}`
        : "";
  const autoPingTooltip = autoPing?.provider === "codex"
    ? "Auto-starts the next 5h Codex window after reset by sending a tiny gpt-5.5 request. Consumes a small amount of quota."
    : "When your 5h quota runs out, auto-sends a request the moment it resets so a new window starts right away.";

  let maskedProxyUrl = "";
  if (boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl) {
    const rawProxyUrl = boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl;
    try {
      const parsed = new URL(rawProxyUrl);
      maskedProxyUrl = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    } catch {
      maskedProxyUrl = rawProxyUrl;
    }
  }

  const noProxyText = boundProxyPool?.noProxy || connection.providerSpecificData?.connectionNoProxy || "";

  let proxyBadgeVariant = "default";
  if (boundProxyPool?.isActive === true) {
    proxyBadgeVariant = "success";
  } else if (boundProxyPoolId || hasLegacyProxy) {
    proxyBadgeVariant = "error";
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showProxyDropdown) return;
    const handler = (e) => {
      if (proxyDropdownRef.current && !proxyDropdownRef.current.contains(e.target)) {
        setShowProxyDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProxyDropdown]);

  const handleSelectProxy = async (poolId) => {
    setUpdatingProxy(true);
    try {
      await onUpdateProxy(poolId === "__none__" ? null : poolId);
    } finally {
      setUpdatingProxy(false);
      setShowProxyDropdown(false);
    }
  };

  const rowAuthType = connection.authType || (isOAuth ? "oauth" : "apikey");
  const isOAuthConnection = rowAuthType === "oauth";
  const isCookieConnection = rowAuthType === "cookie";
  const authIcon = isCookieConnection ? "cookie" : isOAuthConnection ? "lock" : "key";
  const authLabel = isOAuthConnection ? "OAuth" : isCookieConnection ? "Cookie" : "API Key";
  const displayName = connection.name?.trim()
    || connection.email?.trim()
    || connection.displayName?.trim()
    || (isOAuthConnection ? "OAuth Account" : isCookieConnection ? "Cookie Account" : "API Key");
  const secondaryDisplayName = connection.name?.trim() && connection.email?.trim() && connection.name.trim() !== connection.email.trim()
    ? connection.email.trim()
    : connection.name?.trim() && connection.displayName?.trim() && connection.name.trim() !== connection.displayName.trim()
      ? connection.displayName.trim()
      : null;
  const verificationError = verification?.error === "Verification link expired" || verification?.error === "Unable to load verification link"
    ? verification.error
    : null;
  const codexPlan = getPersistedCodexPlan(connection);

  // Use useState + useEffect for impure Date.now() to avoid calling during render
  const [isCooldown, setIsCooldown] = useState(false);

  // Get earliest model lock timestamp (useEffect handles the Date.now() comparison)
  const modelLockUntil = Object.entries(connection)
    .filter(([k]) => k.startsWith("modelLock_"))
    .map(([, v]) => v)
    .filter(v => !!v)
    .sort()[0] || null;

  useEffect(() => {
    const checkCooldown = () => {
      const until = Object.entries(connection)
        .filter(([k]) => k.startsWith("modelLock_"))
        .map(([, v]) => v)
        .filter(v => v && new Date(v).getTime() > Date.now())
        .sort()[0] || null;
      setIsCooldown(!!until);
    };

    checkCooldown();
    const interval = modelLockUntil ? setInterval(checkCooldown, 1000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [modelLockUntil]);

  // Determine effective status (override unavailable if cooldown expired)
  const effectiveStatus = (connection.testStatus === "unavailable" && !isCooldown)
    ? "active"  // Cooldown expired u2192 treat as active
    : connection.testStatus;

  const getStatusVariant = () => getConnectionStatusVariant(connection.isActive, effectiveStatus);

  const getOneByOneVariant = () => {
    if (!oneByOneStatus) return "default";
    if (oneByOneStatus.state === "success") return "success";
    if (oneByOneStatus.state === "failed") return "error";
    if (oneByOneStatus.state === "testing") return "primary";
    return "default";
  };

  const getOneByOneLabel = () => {
    if (!oneByOneStatus) return null;
    if (oneByOneStatus.state === "queued") return "queued";
    if (oneByOneStatus.state === "testing") return "testing";
    if (oneByOneStatus.state === "success") return "success";
    if (oneByOneStatus.state === "failed") return oneByOneStatus.error ? `failed: ${oneByOneStatus.error}` : "failed";
    return null;
  };

  const getHotReloadLabel = () => {
    if (!hotReloadStatus) return null;
    if (hotReloadStatus.state === "queued") return "queued";
    if (hotReloadStatus.state === "testing") return "reloading";
    if (hotReloadStatus.state === "success") return "reloaded";
    if (hotReloadStatus.state === "partial") return hotReloadStatus.error ? `partial: ${hotReloadStatus.error}` : "partial";
    if (hotReloadStatus.state === "failed") return hotReloadStatus.error ? `failed: ${hotReloadStatus.error}` : "failed";
    return null;
  };

  return (
    <div className={`group flex min-w-0 flex-col gap-3 rounded-lg p-2 transition-colors duration-150 hover:bg-surface-2 sm:flex-row sm:items-center sm:justify-between ${connection.isActive === false ? "opacity-60" : ""}`}>
      <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center sm:gap-3">
        {/* Priority arrows */}
        <div className="flex shrink-0 flex-col">
          <Button
            variant="bare" size="icon-sm"
            onClick={onMoveUp}
            disabled={isFirst}
            className={isFirst ? "text-text-muted cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-brand"}
            title="Raise connection priority"
            aria-label="Raise connection priority"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">keyboard_arrow_up</span>
          </Button>
          <Button
            variant="bare" size="icon-sm"
            onClick={onMoveDown}
            disabled={isLast}
            className={isLast ? "text-text-muted cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-brand"}
            title="Lower connection priority"
            aria-label="Lower connection priority"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">keyboard_arrow_down</span>
          </Button>
        </div>
        <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-sm text-text-muted">
          {authIcon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {secondaryDisplayName && (
            <p className="text-xs text-text-muted truncate">{secondaryDisplayName}</p>
          )}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
            <Badge variant={getStatusVariant()} size="sm" dot>
              {connection.isActive === false ? "disabled" : (effectiveStatus || "Unknown")}
            </Badge>
            <Badge variant="default" size="sm">
              {authLabel}
            </Badge>
            {codexPlan && (
              <Badge variant="primary" size="sm">
                <span className="sr-only">Codex subscription plan </span>
                {codexPlan}
              </Badge>
            )}
            {hasAnyProxy && (
              <Badge variant={proxyBadgeVariant} size="sm">
                Proxy
              </Badge>
            )}
            {isCooldown && connection.isActive !== false && <CooldownTimer until={modelLockUntil} />}
            {connection.lastError && connection.isActive !== false && (
              <span className="max-w-full truncate text-xs text-danger sm:max-w-[300px]" title={connection.lastError}>
                {connection.lastError}
              </span>
            )}
            <span className="text-xs text-text-muted">#{connection.priority}</span>
            {connection.globalPriority && (
              <span className="text-xs text-text-muted">Auto: {connection.globalPriority}</span>
            )}
            {getOneByOneLabel() && (
              <Badge variant={getOneByOneVariant()} size="sm">
                {getOneByOneLabel()}
              </Badge>
            )}
            {getHotReloadLabel() && (
              <Badge
                variant={HOT_RELOAD_BADGE_VARIANTS[hotReloadStatus.state] || "default"}
                size="sm"
                title={hotReloadStatus.error || undefined}
              >
                {getHotReloadLabel()}
              </Badge>
            )}
            {verification && (
              <span className="text-xs text-warning">
                {translate("Antigravity account verification required")}
              </span>
            )}
            {verificationError && (
              <span className="text-xs text-warning">
                {translate(verificationError)}
              </span>
            )}
          </div>
          {hasAnyProxy && (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="max-w-full truncate text-xs text-text-muted sm:max-w-[420px]" title={proxyDisplayText}>
                {proxyDisplayText}
              </span>
              {maskedProxyUrl && (
                <code className="max-w-full truncate rounded bg-surface-2 px-1 py-0.5 font-mono text-xs text-text-muted sm:max-w-[260px]">
                  {maskedProxyUrl}
                </code>
              )}
              {noProxyText && (
                <span className="max-w-full truncate text-xs text-text-muted sm:max-w-[320px]" title={noProxyText}>
                  no_proxy: {noProxyText}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
        <div className="flex flex-1 flex-wrap gap-1 sm:flex-none">
          {verification?.href && (
            <a
              href={verification.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${translate("Verify Antigravity account")} ${displayName}`}
              className="focus-ring flex flex-col items-center rounded px-2 py-1 text-warning"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">verified_user</span>
              <span className="text-[10px] leading-tight">{translate("Verify Antigravity account")}</span>
            </a>
          )}
          {verification && (
            <button
              onClick={verification.onRecheck}
              disabled={verification.rechecking}
              className="focus-ring flex flex-col items-center rounded px-2 py-1 text-warning transition-colors duration-150 hover:bg-warning-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-[18px] ${verification.rechecking ? "animate-spin" : ""}`}>
                {verification.rechecking ? "progress_activity" : "refresh"}
              </span>
              <span className="text-[10px] leading-tight">{translate("Check verification")}</span>
            </button>
          )}
          {/* Proxy button with inline dropdown */}
          {(proxyPools || []).length > 0 && (
            <div className="relative" ref={proxyDropdownRef}>
              <button
                onClick={() => setShowProxyDropdown((v) => !v)}
                className={`focus-ring flex w-full flex-col items-center rounded px-2 py-1 transition-colors duration-150 hover:bg-surface-2 ${hasAnyProxy ? "text-brand" : "text-text-muted hover:text-brand"}`}
                disabled={updatingProxy}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                  {updatingProxy ? "progress_activity" : "lan"}
                </span>
                <span className="text-xs leading-tight">Proxy</span>
              </button>
              {showProxyDropdown && (
                <div className="absolute right-0 top-full z-50 mt-1 max-w-[78vw] min-w-[160px] rounded-lg border border-border bg-bg py-1 shadow-elev">
                  <button
                    onClick={() => handleSelectProxy("__none__")}
                    className={`focus-ring w-full text-left px-3 py-1.5 text-sm hover:bg-surface-2 ${!boundProxyPoolId ? "text-brand font-medium" : "text-text-main"}`}
                  >
                    None
                  </button>
                  {(proxyPools || []).map((pool) => (
                    <button
                      key={pool.id}
                      onClick={() => handleSelectProxy(pool.id)}
                      className={`focus-ring w-full text-left px-3 py-1.5 text-sm hover:bg-surface-2 ${boundProxyPoolId === pool.id ? "text-brand font-medium" : "text-text-main"}`}
                    >
                      {pool.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {autoPing && (
            <Tooltip text={autoPingTooltip}>
              <button
                onClick={() => autoPing.onToggle(!autoPing.on)}
                className={`focus-ring flex w-full flex-col items-center rounded px-2 py-1 transition-colors duration-150 hover:bg-surface-2 ${autoPing.on ? "text-brand" : "text-text-muted hover:text-brand"}`}
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[18px]">bolt</span>
                <span className="text-xs leading-tight">Auto-ping</span>
              </button>
            </Tooltip>
          )}
          {hotReload && (
            <Tooltip text="Hot reload: poke both quota models so the pending 7-day countdown starts now">
              <button
                onClick={hotReload.onRun}
                disabled={hotReload.running}
                title={hotReloadStatus?.state === "failed" ? hotReloadStatus.error : undefined}
                className="focus-ring flex flex-col items-center rounded px-2 py-1 text-text-muted hover:bg-surface-2 hover:text-brand"
              >
                <span aria-hidden="true" className={`material-symbols-outlined text-[18px] ${hotReloadStatus?.state === "testing" ? "animate-spin" : ""}`}>{hotReloadStatus?.state === "testing" ? "progress_activity" : "rocket_launch"}</span>
                <span className="text-xs leading-tight">{hotReloadStatus?.state === "testing" ? "Reloading" : "Hot reload"}</span>
              </button>
            </Tooltip>
          )}
          <button onClick={onEdit} className="focus-ring flex flex-col items-center rounded px-2 py-1 text-text-muted hover:bg-surface-2 hover:text-brand">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">edit</span>
            <span className="text-xs leading-tight">Edit</span>
          </button>
          <button onClick={onDelete} className="focus-ring flex flex-col items-center rounded px-2 py-1 text-danger hover:bg-danger-soft">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">delete</span>
            <span className="text-xs leading-tight">Delete</span>
          </button>
        </div>
        <Toggle
          size="sm"
          checked={connection.isActive ?? true}
          onChange={onToggleActive}
          title={(connection.isActive ?? true) ? "Disable connection" : "Enable connection"}
        />
      </div>
    </div>
  );
}

ConnectionRow.propTypes = {
  connection: PropTypes.shape({
    id: PropTypes.string,
    provider: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    displayName: PropTypes.string,
    modelLockUntil: PropTypes.string,
    testStatus: PropTypes.string,
    isActive: PropTypes.bool,
    lastError: PropTypes.string,
    priority: PropTypes.number,
    globalPriority: PropTypes.number,
    providerSpecificData: PropTypes.shape({
      codexSubscriptionPlan: PropTypes.string,
      chatgptPlanType: PropTypes.string,
    }),
  }).isRequired,
  proxyPools: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    proxyUrl: PropTypes.string,
    noProxy: PropTypes.string,
    isActive: PropTypes.bool,
  })),
  isOAuth: PropTypes.bool.isRequired,
  isFirst: PropTypes.bool.isRequired,
  isLast: PropTypes.bool.isRequired,
  onMoveUp: PropTypes.func.isRequired,
  onMoveDown: PropTypes.func.isRequired,
  onToggleActive: PropTypes.func.isRequired,
  onUpdateProxy: PropTypes.func,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  oneByOneStatus: PropTypes.shape({
    state: PropTypes.string,
    error: PropTypes.string,
  }),
  autoPing: PropTypes.shape({
    on: PropTypes.bool,
    onToggle: PropTypes.func,
    provider: PropTypes.string,
  }),
  hotReload: PropTypes.shape({
    running: PropTypes.bool,
    onRun: PropTypes.func,
  }),
  hotReloadStatus: PropTypes.shape({
    state: PropTypes.string,
    error: PropTypes.string,
  }),
  verification: PropTypes.shape({
    connectionId: PropTypes.string,
    challengeId: PropTypes.string,
    expiresAt: PropTypes.number,
    href: PropTypes.string,
    rechecking: PropTypes.bool,
    error: PropTypes.string,
    onRecheck: PropTypes.func,
  }),
};
