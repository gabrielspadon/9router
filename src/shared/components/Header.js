"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import PropTypes from "prop-types";
import ProviderIcon from "@/shared/components/ProviderIcon";
import HeaderMenu from "@/shared/components/HeaderMenu";
import HeaderLanguage from "@/shared/components/HeaderLanguage";
import ThemeToggle from "@/shared/components/ThemeToggle";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS } from "@/shared/constants/providers";
import { getProviderIconSrc } from "@/shared/utils/providerIcon";
import { translate } from "@/i18n/runtime";
import Button from "@/shared/components/Button";

const getPageInfo = (pathname) => {
  if (!pathname) return { title: "", description: "", breadcrumbs: [] };

  // Media provider detail: /dashboard/media-providers/[kind]/[id]
  const mediaDetailMatch = pathname.match(/\/media-providers\/([^/]+)\/([^/]+)$/);
  if (mediaDetailMatch) {
    const kindId = mediaDetailMatch[1];
    const providerId = mediaDetailMatch[2];
    const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);
    const provider = AI_PROVIDERS[providerId];
    return {
      title: provider?.name || providerId,
      description: "",
      breadcrumbs: [
        { label: "Media Providers", href: `/dashboard/media-providers/${kindId}` },
        { label: kindConfig?.label || kindId, href: `/dashboard/media-providers/${kindId}` },
        { label: provider?.name || providerId, image: getProviderIconSrc(providerId) },
      ],
    };
  }

  // Media provider kind: /dashboard/media-providers/[kind]
  const mediaKindMatch = pathname.match(/\/media-providers\/([^/]+)$/);
  if (mediaKindMatch) {
    const kindId = mediaKindMatch[1];
    const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);
    return {
      title: kindConfig?.label || kindId,
      description: `Manage your ${kindConfig?.label || kindId} providers`,
      icon: kindConfig?.icon || "perm_media",
      breadcrumbs: [],
    };
  }

  // Provider detail page: /dashboard/providers/[id]
  const providerMatch = pathname.match(/\/providers\/([^/]+)$/);
  if (providerMatch) {
    const providerId = providerMatch[1];
    const providerInfo =
      OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId];
    if (providerInfo) {
      return {
        title: providerInfo.name,
        description: "",
        breadcrumbs: [
          { label: "Providers", href: "/dashboard/providers" },
          {
            label: providerInfo.name,
            image: getProviderIconSrc(providerInfo.id),
          },
        ],
      };
    }
  }

  if (pathname.includes("/providers") && !pathname.includes("/media-providers"))
    return {
      title: "Providers",
      description: "Manage your AI provider connections",
      icon: "dns",
      breadcrumbs: [],
    };
  if (pathname.includes("/combos"))
    return {
      title: "Combos",
      description: "Model combos with fallback",
      icon: "layers",
      breadcrumbs: [],
    };
  if (pathname.includes("/usage"))
    return {
      title: "Usage & Analytics",
      description:
        "Monitor your API usage, token consumption, and request logs",
      icon: "bar_chart",
      breadcrumbs: [],
    };
  if (pathname.includes("/auth-files"))
    return {
      title: "Auth Files",
      description: "Map provider credentials stored in the local database",
      icon: "vpn_key",
      breadcrumbs: [],
    };
  if (pathname.includes("/statistics"))
    return {
      title: "Statistics",
      description: "Request, token and latency history",
      icon: "insights",
      breadcrumbs: [],
    };
  if (pathname.includes("/memory"))
    return {
      title: "Memory & Context",
      description: "Conversation memory and context windows",
      icon: "psychology",
      breadcrumbs: [],
    };
  if (pathname.includes("/claude-compat"))
    return {
      title: "Claude Compat",
      description: "Claude-format compatibility settings",
      icon: "smart_toy",
      breadcrumbs: [],
    };
  if (pathname.includes("/model-context"))
    return {
      title: "Model Context",
      description: "Per-model context window overrides",
      icon: "memory",
      breadcrumbs: [],
    };
  if (pathname.includes("/basic-chat"))
    return {
      title: "Basic Chat",
      description: "Send a request through the gateway",
      icon: "chat",
      breadcrumbs: [],
    };
  if (pathname.includes("/gallery"))
    return {
      title: "Component Gallery",
      description: "Every primitive in every state it is allowed to be in",
      icon: "palette",
      breadcrumbs: [],
    };
  if (pathname.includes("/pxpipe"))
    return {
      title: "PXPIPE",
      description: "Image pipeline",
      icon: "image",
      breadcrumbs: [],
    };
  if (pathname.includes("/quota"))
    return {
      title: "Quota Tracker",
      description: "Track and manage your API quota limits",
      icon: "data_usage",
      breadcrumbs: [],
    };
  if (pathname.includes("/token-saver"))
    return {
      title: "Token Saver",
      description: "Compress prompts and outputs to save tokens",
      icon: "savings",
      breadcrumbs: [],
    };
  if (pathname.includes("/proxy-pools"))
    return {
      title: "Proxy Pools",
      description: "Manage your proxy pool configurations",
      icon: "lan",
      breadcrumbs: [],
    };
  if (pathname.includes("/skills"))
    return {
      title: "Agent Skills",
      description: "Copy a link and paste to your AI to use TokenProxy — no install needed",
      icon: "extension",
      breadcrumbs: [],
    };
  if (pathname.includes("/endpoint"))
    return {
      title: "Endpoint",
      description: "API endpoint configuration",
      icon: "api",
      breadcrumbs: [],
    };
  if (pathname.includes("/settings/pricing"))
    return {
      title: "Pricing",
      description: "Rates used to cost requests, in dollars per million tokens",
      icon: "payments",
      breadcrumbs: [],
    };
  if (pathname.includes("/profile"))
    return {
      title: "Settings",
      description: "Manage your preferences",
      icon: "settings",
      breadcrumbs: [],
    };
  if (pathname.includes("/translator"))
    return {
      title: "Translator",
      description: "Debug translation flow between formats",
      icon: "translate",
      breadcrumbs: [],
    };
  if (pathname.includes("/console-log"))
    return {
      title: "Console Log",
      description: "Live server console output",
      icon: "monitor",
      breadcrumbs: [],
    };
  if (pathname === "/dashboard")
    return {
      title: "Overview",
      description: "Router state and the client endpoint",
      icon: "monitoring",
      breadcrumbs: [],
    };
  return { title: "", description: "", breadcrumbs: [] };
};

export default function Header({ onMenuClick, showMenuButton = true }) {
  const pathname = usePathname();
  const [displayName, setDisplayName] = useState("");
  const [loginMethod, setLoginMethod] = useState("");

  // Memoize page info to prevent unnecessary recalculations
  const pageInfo = useMemo(() => getPageInfo(pathname), [pathname]);
  const { title, description, icon, breadcrumbs } = pageInfo;

  useEffect(() => {
    let cancelled = false;

    async function loadAuthStatus() {
      try {
        const res = await fetch("/api/auth/status", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setDisplayName(data?.displayName || data?.samlName || data?.samlEmail || data?.oidcName || data?.oidcEmail || "");
          setLoginMethod(data?.loginMethod || "");
        }
      } catch {
        if (!cancelled) {
          setDisplayName("");
          setLoginMethod("");
        }
      }
    }

    loadAuthStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        window.location.assign("/login");
      }
    } catch (err) {
      console.error("Failed to logout:", err);
    }
  };

  return (
    <header className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 lg:gap-3 lg:flex-nowrap lg:px-8 pt-3 pb-2 border-b border-border-subtle bg-surface/60 backdrop-blur-xl lg:bg-transparent lg:backdrop-blur-none z-20">
      {/* Mobile menu button */}
      <div className="flex items-center gap-3 lg:hidden shrink-0">
        {showMenuButton && (
          <Button
            variant="bare" size="icon"
            type="button"
            onClick={onMenuClick}
            aria-label={translate("Menu")}
            className="min-h-11 min-w-11 text-text-main hover:text-brand"
          >
            <span aria-hidden="true" className="material-symbols-outlined">menu</span>
          </Button>
        )}
      </div>

      {/* Page title with breadcrumbs */}
      <div className="flex flex-col min-w-0 flex-1">
        {breadcrumbs.length > 0 ? (
          <div className="flex min-w-0 items-center gap-2">
            {breadcrumbs.map((crumb, index) => (
              <div
                key={`${crumb.label}-${crumb.href || "current"}`}
                className="flex min-w-0 items-center gap-2"
              >
                {index > 0 && (
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined dir-icon text-text-muted text-base"
                  >
                    chevron_right
                  </span>
                )}
                {crumb.href ? (
                  <Link
                    href={crumb.href}
                    className="hit-44 text-text-muted hover:text-brand transition-colors"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <div className="flex min-w-0 items-center gap-2">
                    {crumb.image && (
                      <ProviderIcon
                        src={crumb.image}
                        alt={crumb.label}
                        size={28}
                        className="object-contain rounded max-w-[28px] max-h-[28px]"
                        fallbackText={crumb.label.slice(0, 2).toUpperCase()}
                      />
                    )}
                    <h1 className="text-base lg:text-2xl font-semibold text-text-main tracking-tight truncate">
                      {translate(crumb.label)}
                    </h1>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : title ? (
          <div>
            <div className="flex items-center gap-2 min-w-0">
              {icon && (
                <span className="hidden sm:inline shrink-0">
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-brand text-xl"
                  >
                    {icon}
                  </span>
                </span>
              )}
              <h1 className="text-base lg:text-lg font-semibold tracking-tight text-text-main min-w-0 truncate">
                {translate(title)}
              </h1>
            </div>
            {description && (
              <p className="hidden lg:block text-xs text-text-muted min-w-0">
                {translate(description)}
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div className="order-last basis-full lg:order-none lg:basis-auto">
        <HeaderSearch />
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-1 shrink-0">
        {displayName && (loginMethod === "OIDC" || loginMethod === "SAML") && (
          <div
            className="hidden sm:flex items-center max-w-[220px] px-3 py-1.5 rounded-full border border-border bg-surface/70 text-xs text-text-muted truncate"
            title={displayName}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[14px] me-1.5 text-brand">person</span>
            <span className="truncate">{displayName}</span>
            <span className="ms-2 shrink-0 rounded-full bg-brand-soft px-2 py-1 font-mono text-[10.5px] font-semibold text-brand">
              {loginMethod}
            </span>
          </div>
        )}
        <ThemeToggle />
        <HeaderLanguage />
        <HeaderMenu onLogout={handleLogout} />
      </div>
    </header>
  );
}

function HeaderSearch() {
  const visible = useHeaderSearchStore((s) => s.visible);
  const query = useHeaderSearchStore((s) => s.query);
  const placeholder = useHeaderSearchStore((s) => s.placeholder);
  const setQuery = useHeaderSearchStore((s) => s.setQuery);

  if (!visible) return null;

  return (
    <div className="relative w-full lg:w-[220px]">
      <span
        aria-hidden="true"
        className="material-symbols-outlined absolute start-2 top-1/2 -translate-y-1/2 text-text-muted text-[16px] pointer-events-none"
      >
        search
      </span>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder || translate("Search")}
        className="focus-ring w-full h-11 ps-8 pe-12 rounded-lg border border-border bg-surface/60 text-sm focus:border-brand-solid transition-colors"
      />
      {query && (
        <Button
          variant="bare" size="icon-sm"
          type="button"
          onClick={() => setQuery("")}
          className="absolute end-0 top-1/2 min-h-11 min-w-11 -translate-y-1/2 text-text-muted hover:text-text-main"
          aria-label="Clear search"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">close</span>
        </Button>
      )}
    </div>
  );
}

Header.propTypes = {
  onMenuClick: PropTypes.func,
  showMenuButton: PropTypes.bool,
};
