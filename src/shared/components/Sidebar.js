"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useNavSettings } from "@/shared/hooks/useNavSettings";
import Button from "./Button";
import { ConfirmModal } from "./Modal";

// const VISIBLE_MEDIA_KINDS = ["embedding", "image", "imageToText", "tts", "stt", "webSearch", "webFetch", "video", "music"];
const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
const COMBINED_WEB_ITEM = {
  id: "web",
  label: "Web Fetch & Search",
  icon: "travel_explore",
  href: "/dashboard/media-providers/web",
};

// The rail is grouped by what the product actually does. A flat list of ten
// destinations made the reader work out the shape of the product; naming the
// four jobs states it. `job` is presentational grouping only: the hrefs, the
// hideable ids and the active-route logic are unchanged.
export const NAV_JOBS = ["Connect", "Compose", "Point", "Watch"];

export const navItems = [
  { href: "/dashboard/providers", label: "Providers", icon: "dns", job: "Connect" },
  {
    href: "/dashboard/combos",
    label: "Combo & Vision Adapter",
    icon: "layers",
    job: "Compose",
  },
  { href: "/dashboard/memory", label: "Memory & Context", icon: "psychology", job: "Compose" },
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api", job: "Point" },
  { href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat", job: "Point" },
  // PXPIPE is deliberately absent: it is an optional add-on that is not installed on
  // most hosts, so a permanent rail slot would advertise a page that mostly reports
  // "not installed". Token Saver links to it from the panel that knows the install
  // state (TokenSaverClient.js), which is where it is relevant.
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart", job: "Watch" },
  { href: "/dashboard/statistics", label: "Statistics", icon: "insights", job: "Watch" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage", job: "Watch" },
  { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings", job: "Watch" },
  { href: "/dashboard/context", label: "Context", icon: "monitoring", job: "Watch" },
];

// Entries hideable via Settings → Claude Code Minimal Mode. Persisted as
// settings.hiddenNavItems (array of ids); missing/empty = show everything.
export const HIDEABLE_NAV_ITEMS = [
  { id: "combos", label: "Combo & Vision Adapter", href: "/dashboard/combos" },
  { id: "usage", label: "Usage", href: "/dashboard/usage" },
  { id: "quota", label: "Quota Tracker", href: "/dashboard/quota" },
  { id: "tokenSaver", label: "Token Saver", href: "/dashboard/token-saver" },
  { id: "context", label: "Context", href: "/dashboard/context" },
  { id: "mediaProviders", label: "Media Providers" },
  { id: "proxyPools", label: "Proxy Pools", href: "/dashboard/proxy-pools" },
  { id: "skills", label: "Skills", href: "/dashboard/skills" },
];

export const NAV_ID_BY_HREF = Object.fromEntries(
  HIDEABLE_NAV_ITEMS.filter((i) => i.href).map((i) => [i.href, i.id]),
);

const debugItems = [
  { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
  { href: "/dashboard/gallery", label: "Component Gallery", icon: "palette" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate" },
];

const systemItems = [
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
  { href: "/dashboard/skills", label: "Skills", icon: "extension" },
  { href: "/dashboard/model-context", label: "Model Context", icon: "memory" },
  { href: "/dashboard/settings/pricing", label: "Pricing", icon: "payments" },
];

export default function Sidebar({ onClose, label = "Primary" }) {
  const pathname = usePathname();
  const [mediaOpen, setMediaOpen] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  // True when the automatic updater refused or failed and the user needs the
  // manual Copy & Shutdown instructions instead.
  const [manualUpdateFallback, setManualUpdateFallback] = useState(false);
  const [shutdownCountdown, setShutdownCountdown] = useState(0);
  // Shared with the phone job bar, so the two cannot disagree about which
  // destinations minimal mode has hidden.
  const { hiddenNav, enableTranslator } = useNavSettings();
  const { copied, copy } = useCopyToClipboard(2000);

  const INSTALL_CMD = UPDATER_CONFIG.installCmdLatest;
  const TRAY_RELAUNCH_CMD = updateInfo?.isTrayMode ? "tokenproxy --tray" : null;
  const MANUAL_UPDATE_CMD = TRAY_RELAUNCH_CMD
    ? `${INSTALL_CMD} && ${TRAY_RELAUNCH_CMD}`
    : INSTALL_CMD;

  // Lazy check for new npm version on mount
  useEffect(() => {
    fetch("/api/version")
      .then((res) => res.json())
      .then((data) => {
        if (data.hasUpdate) setUpdateInfo(data);
      })
      .catch(() => {});
  }, []);

  const isActive = (href) => {
    if (href === "/dashboard/endpoint") {
      return (
        pathname === "/dashboard" || pathname.startsWith("/dashboard/endpoint")
      );
    }
    return pathname.startsWith(href);
  };

  // Minimal-mode filter: drop nav entries whose id is in settings.hiddenNavItems.
  const isNavHidden = (id) => hiddenNav.has(id);

  // Update Now: start the detached updater, which relaunches on its own.
  //
  // This used to open the manual Copy & Shutdown panel directly, so the button
  // never called the working backend at all — /api/version/update and
  // src/lib/updater/updater.js were reachable only by hand (#1120). The manual
  // panel is kept as the FALLBACK, since the endpoint refuses outside a
  // production build and can fail for reasons the user still needs a way past.
  const handleUpdate = async () => {
    setShowUpdateModal(false);
    setIsUpdating(true);
    try {
      const res = await fetch("/api/version/update", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      // On success the server exits and the disconnected panel takes over, so
      // there is nothing more to do here.
      if (res.ok && data.success) return;
    } catch { /* fall through to the manual panel */ }
    setManualUpdateFallback(true);
  };

  // Triggered by Copy button inside ManualUpdatePanel: copy + countdown + shutdown
  const handleCopyAndShutdown = async () => {
    try {
      await navigator.clipboard.writeText(MANUAL_UPDATE_CMD);
    } catch {
      /* clipboard blocked */
    }
    copy(MANUAL_UPDATE_CMD);
    let remaining = UPDATER_CONFIG.shutdownCountdownSec;
    setShutdownCountdown(remaining);
    const timer = setInterval(() => {
      remaining -= 1;
      setShutdownCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        fetch("/api/version/shutdown", { method: "POST" }).catch(() => {});
        setIsDisconnected(true);
      }
    }, 1000);
  };

  const handleCancelUpdate = () => {
    setIsUpdating(false);
    setShutdownCountdown(0);
  };

  // Note: legacy updater poll removed. New flow: copy install cmd + shutdown server,
  // user runs the command manually in another terminal.

  return (
    <>
      <div className="flex w-72 flex-col border-e border-border-subtle bg-vibrancy backdrop-blur-xl transition-colors duration-150 min-h-full">
        {/* Logo */}
        <div className="px-5.5 pt-5.5 pb-4 flex flex-col gap-2">
          <Link href="/dashboard" className="flex min-h-11 items-center gap-3">
            <div className="flex items-center justify-center size-9 rounded-[var(--radius-brand)] bg-gradient-to-br from-brand-500 to-brand-700">
              <span aria-hidden="true" className="material-symbols-outlined text-white text-[20px]">
                hub
              </span>
            </div>
            <div className="flex flex-col">
              <p className="text-lg font-semibold tracking-tight text-text-main">
                {APP_CONFIG.name}
              </p>
              <span className="text-xs text-text-muted">
                v{APP_CONFIG.version}
              </span>
            </div>
          </Link>
          {updateInfo && (
            <div className="flex flex-col gap-1.5 rounded p-1 -m-1">
              <span className="text-xs font-semibold text-info">
                ↑ New version available: v{updateInfo.latestVersion}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="primary" size="sm"
                  onClick={() => setShowUpdateModal(true)}
                >
                  Update now
                </Button>
                <button
                  onClick={() => copy(INSTALL_CMD)}
                  title="Copy install command"
                  className="flex-1 min-h-11 text-start hover:underline transition-colors cursor-pointer min-w-0"
                >
                  <code className="block text-[10.5px] text-text-muted font-mono truncate">
                    {copied ? "✓ copied!" : INSTALL_CMD}
                  </code>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav
          aria-label={label}
          className="flex-1 px-4 py-2 space-y-1 overflow-y-auto custom-scrollbar"
        >
          {(() => {
            // Grouped by job, numbered across the whole rail so a number is a
            // stable address someone can quote. The filter, the active-route
            // test and the close behaviour are exactly as before.
            const visible = navItems.filter(
              (item) => !isNavHidden(NAV_ID_BY_HREF[item.href]),
            );
            return NAV_JOBS.map((job) => {
              const items = visible.filter((item) => item.job === job);
              if (!items.length) return null;
              return (
                <div key={job} className="pb-2">
                  <p className="px-3 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-text-subtle">
                    {job}
                  </p>
                  {items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      aria-current={isActive(item.href) ? "page" : undefined}
                      className={cn(
                        "group flex min-h-11 items-center gap-3 border-s-2 px-3 py-1.5 transition-colors",
                        isActive(item.href)
                          ? "border-brand bg-brand-soft text-brand"
                          : "border-transparent text-text-muted hover:bg-surface-2 hover:text-text-main",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="w-[18px] shrink-0 font-mono text-[10.5px] tabular-nums text-text-subtle"
                      >
                        {String(visible.indexOf(item) + 1).padStart(2, "0")}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "material-symbols-outlined text-[18px]",
                          isActive(item.href)
                            ? "fill-1"
                            : "transition-colors group-hover:text-brand",
                        )}
                      >
                        {item.icon}
                      </span>
                      <span className="min-w-0 text-[13px] font-medium">{item.label}</span>
                    </Link>
                  ))}
                </div>
              );
            });
          })()}

          {/* System section */}
          <div className="pt-3 mt-2 space-y-1">
            <p className="mb-1 px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-text-subtle">
              System
            </p>

            {/* Media Providers accordion */}
            {!isNavHidden("mediaProviders") && (
              <>
                <button
                  aria-expanded={mediaOpen}
                  onClick={() => setMediaOpen((v) => !v)}
                  className={cn(
                    "w-full flex min-h-11 items-center gap-3 px-3 py-1 rounded-lg transition-all group",
                    pathname.startsWith("/dashboard/media-providers")
                      ? "bg-brand-soft text-brand"
                      : "text-text-muted hover:bg-surface-2 hover:text-text-main",
                  )}
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                    perm_media
                  </span>
                  <span className="text-[13px] font-medium flex-1 text-start">
                    Media Providers
                  </span>
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-[14px] transition-transform"
                    style={{
                      transform: mediaOpen ? "rotate(180deg)" : "rotate(0deg)",
                    }}
                  >
                    expand_more
                  </span>
                </button>
                {mediaOpen && (
                  <div className="ps-4">
                    {MEDIA_PROVIDER_KINDS.filter((k) =>
                      VISIBLE_MEDIA_KINDS.includes(k.id),
                    ).map((kind) => (
                      <Link
                        key={kind.id}
                        href={`/dashboard/media-providers/${kind.id}`}
                        onClick={onClose}
                        className={cn(
                          "flex min-h-11 items-center gap-3 px-4 py-1 rounded-lg transition-all group",
                          pathname.startsWith(
                            `/dashboard/media-providers/${kind.id}`,
                          )
                            ? "bg-brand-soft text-brand"
                            : "text-text-muted hover:bg-surface-2 hover:text-text-main",
                        )}
                      >
                        <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
                          {kind.icon}
                        </span>
                        <span className="text-sm">{kind.label}</span>
                      </Link>
                    ))}
                    <Link
                      key={COMBINED_WEB_ITEM.id}
                      href={COMBINED_WEB_ITEM.href}
                      onClick={onClose}
                      className={cn(
                        "flex min-h-11 items-center gap-3 px-4 py-1 rounded-lg transition-all group",
                        pathname.startsWith(COMBINED_WEB_ITEM.href)
                          ? "bg-brand-soft text-brand"
                          : "text-text-muted hover:bg-surface-2 hover:text-text-main",
                      )}
                    >
                      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
                        {COMBINED_WEB_ITEM.icon}
                      </span>
                      <span className="text-sm">{COMBINED_WEB_ITEM.label}</span>
                    </Link>
                  </div>
                )}
              </>
            )}

            {systemItems
              .filter((item) => !isNavHidden(NAV_ID_BY_HREF[item.href]))
              .map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex min-h-11 items-center gap-3 px-3 py-1 rounded-lg transition-all group",
                    isActive(item.href)
                      ? "bg-brand-soft text-brand"
                      : "text-text-muted hover:bg-surface-2 hover:text-text-main",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "material-symbols-outlined text-[18px]",
                      isActive(item.href)
                        ? "fill-1"
                        : "group-hover:text-brand transition-colors",
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="text-[13px] font-medium">{item.label}</span>
                </Link>
              ))}

            {/* Debug items (inside System section, before Settings) */}
            {debugItems.map((item) => {
              const show =
                item.href !== "/dashboard/translator" || enableTranslator;
              return show ? (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex min-h-11 items-center gap-3 px-3 py-1 rounded-lg transition-all group",
                    isActive(item.href)
                      ? "bg-brand-soft text-brand"
                      : "text-text-muted hover:bg-surface-2 hover:text-text-main",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "material-symbols-outlined text-[18px]",
                      isActive(item.href)
                        ? "fill-1"
                        : "group-hover:text-brand transition-colors",
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="text-[13px] font-medium">{item.label}</span>
                </Link>
              ) : null;
            })}



            {/* Settings */}
            <Link
              href="/dashboard/profile"
              onClick={onClose}
              className={cn(
                "flex min-h-11 items-center gap-3 px-3 py-1 rounded-lg transition-all group",
                isActive("/dashboard/profile")
                  ? "bg-brand-soft text-brand"
                  : "text-text-muted hover:bg-surface-2 hover:text-text-main",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "material-symbols-outlined text-[18px]",
                  isActive("/dashboard/profile")
                    ? "fill-1"
                    : "group-hover:text-brand transition-colors",
                )}
              >
                settings
              </span>
              <span className="text-[13px] font-medium">Settings</span>
            </Link>
          </div>
        </nav>
        {/* Build identity, baked at app build time (NEXT_PUBLIC_TP_BUILD_SHA).
            Hidden when the value is missing (dev without config) or unknown. */}
        {process.env.NEXT_PUBLIC_TP_BUILD_SHA && process.env.NEXT_PUBLIC_TP_BUILD_SHA !== "unknown" && (
          <div
            data-testid="sidebar-build"
            className="mt-auto px-5.5 py-3 text-[11px] font-mono text-content-tertiary border-t border-border-subtle"
          >
            build {process.env.NEXT_PUBLIC_TP_BUILD_SHA}
          </div>
        )}
      </div>


      {/* Update Confirmation Modal */}
      <ConfirmModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        onConfirm={handleUpdate}
        title="Update TokenProxy"
        message={`Show install command for v${updateInfo?.latestVersion || ""}? You can copy it and shutdown to install manually.`}
        confirmText="Show Command"
        cancelText="Cancel"
        variant="primary"
      />

      {/* Disconnected / Updating Overlay */}
      {(isDisconnected || isUpdating) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-5.5">
          {isUpdating && !manualUpdateFallback && !isDisconnected ? (
            /* Automatic updater running. It exits the server, after which the
               disconnected panel below takes over. Showing the manual Copy &
               Shutdown instructions here would tell the user to do by hand what
               is already happening. */
            <div className="text-center p-8">
              <div className="flex items-center justify-center size-16 rounded-full bg-brand-soft text-brand mx-auto mb-4">
                <span aria-hidden="true" className="material-symbols-outlined text-[32px]">progress_activity</span>
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">Updating TokenProxy</h2>
              <p className="text-text-muted mb-5.5">
                Installing v{updateInfo?.latestVersion || ""} and relaunching. This page will
                reconnect on its own.
              </p>
            </div>
          ) : isUpdating || manualUpdateFallback ? (
            <ManualUpdatePanel
              latestVersion={updateInfo?.latestVersion}
              installCmd={MANUAL_UPDATE_CMD}
              relaunchCmd={TRAY_RELAUNCH_CMD}
              copied={copied}
              onCopyAndShutdown={handleCopyAndShutdown}
              onCancel={handleCancelUpdate}
              countdown={shutdownCountdown}
              isDisconnected={isDisconnected}
            />
          ) : (
            <div className="text-center p-8">
              <div className="flex items-center justify-center size-16 rounded-full bg-danger-soft text-danger mx-auto mb-4">
                <span aria-hidden="true" className="material-symbols-outlined text-[32px]">
                  power_off
                </span>
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">
                Server Disconnected
              </h2>
              <p className="text-text-muted mb-5.5">
                The proxy server has been stopped.
              </p>
              <Button
                variant="secondary"
                onClick={() => globalThis.location.reload()}
              >
                Reload Page
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
  label: PropTypes.string,
};

function ManualUpdatePanel({
  latestVersion,
  installCmd,
  relaunchCmd,
  copied,
  onCopyAndShutdown,
  onCancel,
  countdown,
  isDisconnected,
}) {
  const isCountingDown = countdown > 0;
  return (
    <div className="w-full max-w-lg rounded-[var(--radius-brand-lg)] bg-surface border border-border shadow-elev p-5.5 text-text-main">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center justify-center size-11 rounded-full bg-warning-soft text-warning">
          <span aria-hidden="true" className="material-symbols-outlined text-[24px]">
            content_copy
          </span>
        </div>
        <div>
          <h2 className="text-lg font-semibold">
            Update TokenProxy{latestVersion ? ` to v${latestVersion}` : ""}
          </h2>
          <p className="text-xs text-text-muted">
            {isDisconnected
              ? "Server stopped. Paste the command into a terminal to install."
              : isCountingDown
                ? `Command copied. Server will stop in ${countdown}s...`
                : "Click the button below to copy the install command and shutdown."}
          </p>
        </div>
      </div>

      <p className="text-sm text-text-muted mb-2">Install command:</p>
      <div className="w-full px-3 py-2 rounded bg-surface-2 mb-4">
        <code className="text-xs font-mono text-warning break-all">
          {installCmd}
        </code>
      </div>

      <ol className="text-xs text-text-muted space-y-1 list-decimal list-inside mb-4">
        <li>
          Click <strong>Copy & Shutdown</strong> below.
        </li>
        <li>Paste the command into your terminal and press Enter.</li>
        <li>
          {relaunchCmd ? (
            <>
              npm installs the new version, then{" "}
              <code className="px-1 rounded bg-surface-2 text-text-main">
                {relaunchCmd}
              </code>{" "}
              restarts TokenProxy automatically.
            </>
          ) : (
            <>
              Run{" "}
              <code className="px-1 rounded bg-surface-2 text-text-main">
                tokenproxy
              </code>{" "}
              again after install.
            </>
          )}
        </li>
      </ol>

      {isDisconnected ? (
        <Button
          variant="secondary"
          fullWidth
          onClick={() => globalThis.location.reload()}
        >
          Reload Page
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={onCancel}
            disabled={isCountingDown}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            fullWidth
            onClick={onCopyAndShutdown}
            disabled={isCountingDown}
          >
            {copied
              ? "✓ Copied — shutting down..."
              : isCountingDown
                ? `Shutting down in ${countdown}s`
                : "Copy & Shutdown"}
          </Button>
        </div>
      )}
    </div>
  );
}

ManualUpdatePanel.propTypes = {
  latestVersion: PropTypes.string,
  installCmd: PropTypes.string.isRequired,
  relaunchCmd: PropTypes.string,
  copied: PropTypes.bool,
  onCopyAndShutdown: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  countdown: PropTypes.number,
  isDisconnected: PropTypes.bool,
};
