"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import { CardSkeleton } from "@/shared/components/Loading";
import Badge from "@/shared/components/Badge";
import Button from "@/shared/components/Button";
import Toggle from "@/shared/components/Toggle";
import Select from "@/shared/components/Select";
import ProviderIcon from "@/shared/components/ProviderIcon";
import StatusToken from "@/shared/components/StatusToken";
import { getProviderIconSrc } from "@/shared/utils/providerIcon";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import {
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
  OPENAI_COMPATIBLE_PREFIX,
  ANTHROPIC_COMPATIBLE_PREFIX,
} from "@/shared/constants/providers";
import Link from "next/link";
import { getRelativeTime } from "@/shared/utils";
import { useNotificationStore } from "@/store/notificationStore";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import ModelAvailabilityBadge from "./components/ModelAvailabilityBadge";
import AddCompatibleModal from "./components/AddCompatibleModal";
import NewModelsButton from "./components/NewModelsButton";
import ProviderStatusTokens from "./components/ProviderStatusTokens";
import ProviderHealthMatrix, { headroomFor } from "./components/ProviderHealthMatrix";
import { summarizeProviderConnections } from "./connectionStatus";

const APIKEY_INITIAL_VISIBLE = 20;

export default function ProvidersPage() {
  const [connections, setConnections] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  // Signature element 4. Measured performance per upstream, read from the
  // health endpoint the requestStats rows already back.
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAllApikey, setShowAllApikey] = useState(false);
  const [showAddCompatibleModal, setShowAddCompatibleModal] = useState(false);
  const [showAddAnthropicCompatibleModal, setShowAddAnthropicCompatibleModal] =
    useState(false);
  const [showAddMultiCompatibleModal, setShowAddMultiCompatibleModal] =
    useState(false);
  const [testingMode, setTestingMode] = useState(null);
  const [testResults, setTestResults] = useState(null);
  // Grid filters: hide disabled providers / hide providers with no connections.
  // Persisted locally so the choice survives page reloads.
  const [hideDisabled, setHideDisabled] = useState(false);
  const [hideUnconfigured, setHideUnconfigured] = useState(false);

  useEffect(() => {
    // Deferred one tick: keeps SSR markup (all visible) consistent and avoids
    // the sync-setState-in-effect cascade the react-hooks rule flags.
    const t = setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem("providers.gridFilters") || "{}");
        if (saved.hideDisabled) setHideDisabled(true);
        if (saved.hideUnconfigured) setHideUnconfigured(true);
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const updateGridFilter = (key, value) => {
    (key === "hideDisabled" ? setHideDisabled : setHideUnconfigured)(value);
    try {
      const saved = JSON.parse(localStorage.getItem("providers.gridFilters") || "{}");
      localStorage.setItem(
        "providers.gridFilters",
        JSON.stringify({ ...saved, [key]: value }),
      );
    } catch {}
  };
  const notify = useNotificationStore();
  const searchQuery = useHeaderSearchStore((s) => s.query);
  const registerSearch = useHeaderSearchStore((s) => s.register);
  const unregisterSearch = useHeaderSearchStore((s) => s.unregister);

  useEffect(() => {
    registerSearch("Search providers...");
    return () => unregisterSearch();
  }, [registerSearch, unregisterSearch]);

  const matchSearch = (name) => {
    if (!searchQuery.trim()) return true;
    // A provider entry with no name reached this and threw on toLowerCase,
    // taking the whole grid down mid-search.
    if (!name) return false;
    return name.toLowerCase().includes(searchQuery.trim().toLowerCase());
  };

  // Grid-level filter applied to every card entry list. "Disabled" = all
  // connections toggled off (allDisabled); "unconfigured" = zero connections.
  const matchGridFilter = (key, authType) => {
    const s = getProviderStats(key, authType);
    if (hideUnconfigured && s.total === 0) return false;
    if (hideDisabled && s.total > 0 && s.allDisabled) return false;
    return true;
  };

  const sortByPriority = (entries, authType) =>
    [...entries].sort(([ka, a], [kb, b]) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      const sa = getProviderStats(ka, authType);
      const sb = getProviderStats(kb, authType);
      const ca = sa.connected > 0 ? 1 : 0;
      const cb = sb.connected > 0 ? 1 : 0;
      if (ca !== cb) return cb - ca;
      return (a.name || "").localeCompare(b.name || "");
    });

  const sortItemsByPriority = (items, authType) =>
    [...items].sort((a, b) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      const sa = getProviderStats(a.id, authType);
      const sb = getProviderStats(b.id, authType);
      const ca = sa.connected > 0 ? 1 : 0;
      const cb = sb.connected > 0 ? 1 : 0;
      if (ca !== cb) return cb - ca;
      return (a.name || "").localeCompare(b.name || "");
    });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [connectionsRes, nodesRes, healthRes] = await Promise.all([
          fetch("/api/providers"),
          fetch("/api/provider-nodes"),
          // Grouped by provider, not by account: this grid compares upstreams.
          // A failure here costs the health grid and nothing else, which is why
          // it is settled beside the other two rather than gating them.
          fetch("/api/usage/stats/health?period=7d&groupBy=provider").catch(() => null),
        ]);
        const connectionsData = await connectionsRes.json();
        const nodesData = await nodesRes.json();
        if (connectionsRes.ok)
          setConnections(connectionsData.connections || []);
        if (nodesRes.ok) setProviderNodes(nodesData.nodes || []);
        if (healthRes?.ok) setHealth(await healthRes.json());
      } catch (error) {
        console.log("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Every state a card can show is decided in one place, by connectionStatus.js.
  const getProviderStats = (providerId, authType) => {
    const authTypes = Array.isArray(authType) ? authType : [authType];
    return summarizeProviderConnections(
      connections.filter(
        (c) => c.provider === providerId && authTypes.includes(c.authType),
      ),
    );
  };

  // Toggle all connections for a provider on/off. authType may be a single
  // string or an array (kiro counts oauth + api_key/apikey together).
  const handleToggleProvider = async (providerId, authType, newActive) => {
    const authTypes = Array.isArray(authType) ? authType : [authType];
    const matches = (c) =>
      c.provider === providerId && authTypes.includes(c.authType);
    const providerConns = connections.filter(matches);
    setConnections((prev) =>
      prev.map((c) => (matches(c) ? { ...c, isActive: newActive } : c)),
    );
    await Promise.allSettled(
      providerConns.map((c) =>
        fetch(`/api/providers/${c.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: newActive }),
        }),
      ),
    );
  };

  const handleBatchTest = async (mode, providerId = null) => {
    if (testingMode) return;
    setTestingMode(mode === "provider" ? providerId : mode);
    setTestResults(null);
    try {
      const res = await fetch("/api/providers/test-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, providerId }),
      });
      const data = await res.json();
      setTestResults(data);
      if (data.summary) {
        const { passed, failed, total } = data.summary;
        if (failed === 0) notify.success(`All ${total} tests passed`);
        else notify.warning(`${passed}/${total} passed, ${failed} failed`);
      }
    } catch (error) {
      setTestResults({ error: "Test request failed" });
      notify.error("Provider test failed");
    } finally {
      setTestingMode(null);
    }
  };

  const compatibleProviders = providerNodes
    .filter((node) => node.type === "openai-compatible")
    .map((node) => ({
      id: node.id,
      name: node.name || "OpenAI Compatible",
      color: "#10A37F",
      textIcon: "OC",
      apiType: node.apiType,
    }))
    .filter(
      (p) =>
        matchSearch(p.name) &&
        matchGridFilter(p.id, ["apikey", "api_key"]),
    );

  const anthropicCompatibleProviders = providerNodes
    .filter((node) => node.type === "anthropic-compatible")
    .map((node) => ({
      id: node.id,
      name: node.name || "Anthropic Compatible",
      color: "#D97757",
      textIcon: "AC",
    }))
    .filter(
      (p) =>
        matchSearch(p.name) &&
        matchGridFilter(p.id, ["apikey", "api_key"]),
    );

  const multiCompatibleProviders = providerNodes
    .filter((node) => node.type === "multi-compatible")
    .map((node) => ({
      id: node.id,
      name: node.name || "Multi-protocol Compatible",
      color: "#7C3AED",
      textIcon: "MP",
      apiType: "multi",
    }))
    .filter((p) => matchSearch(p.name));

  // Dual-auth providers (oauth + apikey) store API keys as authType "apikey"
  // (and sometimes "api_key"). Card stats must count both so totals match detail.
  // kiro has no authModes in registry but accepts both (headless uses "api_key").
  const dualAuthTypes = (info, key) => {
    if (key === "kiro") return ["oauth", "apikey", "api_key"];
    const modes = info?.authModes;
    // Free-tier and API-key providers default to supporting apikey even when the
    // registry entry omits authModes (e.g. cloudflare-ai, byteplus, ollama,
    // vertex) — otherwise their apikey connections are invisible on the grid card.
    if (!Array.isArray(modes)) {
      return key in FREE_TIER_PROVIDERS || key in APIKEY_PROVIDERS
        ? ["oauth", "apikey", "api_key"]
        : "oauth";
    }
    if (!modes.includes("apikey")) return "oauth";
    return ["oauth", "apikey", "api_key"];
  };

  const oauthEntries = sortByPriority(
    Object.entries(OAUTH_PROVIDERS).filter(
      ([key, info]) =>
        !info.hidden && matchSearch(info.name) && matchGridFilter(key, dualAuthTypes(info, key)),
    ),
    "oauth",
  );
  const freeEntries = Object.entries(FREE_PROVIDERS)
    .filter(
      ([key, info]) =>
        !info.hidden &&
        matchSearch(info.name) &&
        matchGridFilter(key, dualAuthTypes(info, key)),
    )
    .sort(([, a], [, b]) => (b.noAuth ? 1 : 0) - (a.noAuth ? 1 : 0));
  // Free Tier cards may be oauth-only (e.g. kimchi) or dual-auth, so count via
  // dualAuthTypes per provider instead of a fixed "apikey" — otherwise oauth
  // connections are invisible here (mismatch with the detail page).
  const freeTierEntries = Object.entries(FREE_TIER_PROVIDERS)
    .filter(
      ([key, info]) =>
        !info.hidden &&
        matchSearch(info.name) &&
        (info.serviceKinds ?? ["llm"]).includes("llm") &&
        matchGridFilter(key, dualAuthTypes(info, key)),
    )
    .sort(([ka, a], [kb, b]) => {
      const pa = a.priority ?? 999;
      const pb = b.priority ?? 999;
      if (pa !== pb) return pa - pb;
      const noAuthDiff = (b.noAuth ? 1 : 0) - (a.noAuth ? 1 : 0);
      if (noAuthDiff !== 0) return noAuthDiff;
      const ca = getProviderStats(ka, dualAuthTypes(a, ka)).connected > 0 ? 0 : 1;
      const cb = getProviderStats(kb, dualAuthTypes(b, kb)).connected > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });
  // API Key: connected providers first, then alphabetical by name
  const apikeyEntries = Object.entries(APIKEY_PROVIDERS)
    .filter(
      ([key, info]) =>
        !info.hidden &&
        (info.serviceKinds ?? ["llm"]).includes("llm") &&
        matchSearch(info.name) &&
        matchGridFilter(key, "apikey"),
    )
    .sort(([ka, a], [kb, b]) => {
      const ca = getProviderStats(ka, "apikey").total > 0 ? 0 : 1;
      const cb = getProviderStats(kb, "apikey").total > 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return (a.name || "").localeCompare(b.name || "");
    });
  const isApikeySearching = !!searchQuery.trim();
  const visibleApikeyEntries =
    isApikeySearching || showAllApikey
      ? apikeyEntries
      : apikeyEntries.slice(0, APIKEY_INITIAL_VISIBLE);
  const hiddenApikeyCount = apikeyEntries.length - APIKEY_INITIAL_VISIBLE;

  if (loading) {
    return (
      <div className="flex flex-col gap-5.5">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const hasAnyResult =
    oauthEntries.length > 0 ||
    freeEntries.length > 0 ||
    freeTierEntries.length > 0 ||
    apikeyEntries.length > 0 ||
    compatibleProviders.length > 0 ||
    anthropicCompatibleProviders.length > 0 ||
    multiCompatibleProviders.length > 0;

  // One row per upstream that actually carried traffic in the window. A
  // provider with no requests has no measured health, and inventing a row for
  // it would put "Healthy" against something nothing has ever reached.
  const healthRows = (health?.rows || [])
    .filter((r) => r.provider && r.requests > 0)
    .map((r) => ({
      provider: r.provider,
      name:
        OAUTH_PROVIDERS[r.provider]?.name
        || APIKEY_PROVIDERS[r.provider]?.name
        || FREE_PROVIDERS[r.provider]?.name
        || FREE_TIER_PROVIDERS[r.provider]?.name
        || providerNodes.find((n) => n.id === r.provider)?.name
        || r.providerName
        || r.provider,
      requests: r.requests,
      errors: r.errors,
      avgLatencyMs: r.avgLatencyMs ?? null,
      headroom: headroomFor(connections.filter((c) => c.provider === r.provider)),
    }))
    // Worst first: the reason to look at this grid is the upstream that is
    // failing or about to run out, not the alphabet.
    .sort((a, b) => {
      const ra = a.requests > 0 ? a.errors / a.requests : 0;
      const rb = b.requests > 0 ? b.errors / b.requests : 0;
      if (ra !== rb) return rb - ra;
      return b.requests - a.requests;
    });

  const filterBtnCls = (active) =>
    `focus-ring hit-44 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors duration-150 sm:py-1.5 ${
      active
        ? "bg-brand-soft border-brand-line text-brand"
        : "bg-bg border-border text-text-muted hover:text-text-main hover:border-brand-line"
    }`;

  return (
    <div className="flex min-w-0 flex-col gap-5.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/dashboard/providers/new"
          className="focus-ring hit-44 inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[var(--radius-brand)] bg-brand-solid px-3 text-xs font-semibold text-brand-on transition-colors duration-150 hover:bg-brand-solid-hover"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">add</span>
          Connect a Provider
        </Link>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            onClick={() => updateGridFilter("hideDisabled", !hideDisabled)}
            className={filterBtnCls(hideDisabled)}
            title={hideDisabled ? "Show disabled providers" : "Hide providers with all connections disabled"}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
              {hideDisabled ? "visibility_off" : "visibility"}
            </span>
            {hideDisabled ? "Showing enabled only" : "Hide disabled"}
          </button>
          <button
            onClick={() => updateGridFilter("hideUnconfigured", !hideUnconfigured)}
            className={filterBtnCls(hideUnconfigured)}
            title={hideUnconfigured ? "Show unconfigured providers" : "Hide providers with no connections"}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
              {hideUnconfigured ? "visibility_off" : "visibility"}
            </span>
            {hideUnconfigured ? "Showing configured only" : "Hide unconfigured"}
          </button>
        </div>
      </div>

      {/* Signature element 4, direction.md:85. It sits above the inventory
          because a degraded upstream is the reason to open this route, and
          below the filters because it answers for what is connected rather
          than for what could be. */}
      <ProviderHealthMatrix rows={healthRows} period={health?.period || "7d"} />

      {!hasAnyResult && (
        <div className="text-center py-8 border border-dashed border-border rounded-xl">
          <span aria-hidden="true" className="material-symbols-outlined text-[32px] text-text-muted mb-2">
            search_off
          </span>
          <p className="text-text-muted text-sm">No providers match your search</p>
        </div>
      )}

      {/* New Models discovery */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
            Model Discovery
          </h2>
          <p className="text-xs text-text-muted">
            Track new models added by any provider, including free ones
          </p>
        </div>
        <NewModelsButton />
      </div>

      {/* Custom Providers — dynamic */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
            Custom Providers
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:flex sm:w-auto">
            {/* The batch endpoint has always accepted mode "compatible" and no UI
                ever sent it, so this was the one provider section without the
                Test All the three above it have had (#3505). */}
            <Button
              size="sm"
              variant="secondary"
              icon="play_arrow"
              loading={testingMode === "compatible"}
              onClick={() => handleBatchTest("compatible")}
              disabled={!!testingMode}
              className="w-full sm:w-auto"
              title="Test all custom provider connections"
              aria-label="Test all custom provider connections"
            >
              {testingMode === "compatible" ? "Testing..." : "Test All"}
            </Button>
            <Button
              size="sm"
              icon="add"
              onClick={() => setShowAddMultiCompatibleModal(true)}
              className="w-full sm:w-auto"
            >
              Add Multi-protocol
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="add"
              onClick={() => setShowAddAnthropicCompatibleModal(true)}
              className="w-full sm:w-auto"
            >
              Add Anthropic Compatible
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon="add"
              onClick={() => setShowAddCompatibleModal(true)}
              className="w-full sm:w-auto"
            >
              Add OpenAI Compatible
            </Button>
          </div>
        </div>
        {compatibleProviders.length === 0 &&
        anthropicCompatibleProviders.length === 0 &&
        multiCompatibleProviders.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-2 border border-dashed border-border rounded-xl text-text-muted text-sm">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">extension</span>
            <span>No custom providers. Use the buttons above to add one.</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {[
              ...multiCompatibleProviders,
              ...compatibleProviders,
              ...anthropicCompatibleProviders,
            ].map((info) => (
              <ApiKeyProviderCard
                key={info.id}
                providerId={info.id}
                provider={info}
                stats={getProviderStats(info.id, "apikey")}
                authType="compatible"
                onToggle={(active) =>
                  handleToggleProvider(info.id, "apikey", active)
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* OAuth Providers */}
      {oauthEntries.length > 0 && (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
            OAuth Providers
          </h2>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <ModelAvailabilityBadge />
            <Button
              variant="secondary"
              size="sm"
              icon="play_arrow"
              loading={testingMode === "oauth"}
              onClick={() => handleBatchTest("oauth")}
              disabled={!!testingMode}
              className="w-full sm:w-auto"
              title="Test all OAuth connections"
              aria-label="Test all OAuth connections"
            >
              {testingMode === "oauth" ? "Testing..." : "Test All"}
            </Button>
          </div>
        </div>
        {(() => {
          // Forty providers rendered as one uniform grid weighted the six
          // accounts that carry traffic exactly the same as the thirty-odd that
          // are configured and idle. The set is unchanged and the sort inside
          // each band is unchanged; this only separates what is in use from
          // what is inventory, and lifts anything reporting an error to the
          // front of the band that needs attention.
          const withStats = oauthEntries.map(([key, info]) => {
            const authTypes = dualAuthTypes(info, key);
            return { key, info, authTypes, stats: getProviderStats(key, authTypes) };
          });
          const inUse = withStats
            .filter((e) => e.stats.total > 0)
            .sort((a, b) => (b.stats.error > 0) - (a.stats.error > 0));
          const idle = withStats.filter((e) => e.stats.total === 0);
          const bands = [
            { id: "in-use", label: "Connected", entries: inUse },
            { id: "idle", label: "Not connected", entries: idle },
          ].filter((b) => b.entries.length > 0);

          return bands.map((band) => (
            <div key={band.id} className="flex flex-col gap-3">
              {bands.length > 1 && (
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-subtle">
                  {band.label}
                  <span className="ms-2 tabular-nums">{band.entries.length}</span>
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                {band.entries.map(({ key, info, authTypes, stats }) => (
                  <ProviderCard
                    key={key}
                    providerId={key}
                    provider={info}
                    stats={stats}
                    authType="oauth"
                    onToggle={(active) => handleToggleProvider(key, authTypes, active)}
                  />
                ))}
              </div>
            </div>
          ));
        })()}
      </div>
      )}

      {/* Free-model auto-discovery */}
      <FreeModelSyncCard />

      {/* Free Tier Providers */}
      {(freeEntries.length > 0 || freeTierEntries.length > 0) && (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
            Free Tier Providers
          </h2>
          <Button
            variant="secondary"
            size="sm"
            icon="play_arrow"
            loading={testingMode === "free"}
            onClick={() => handleBatchTest("free")}
            disabled={!!testingMode}
            className="w-full sm:w-auto"
            title="Test all Free connections"
            aria-label="Test all Free provider connections"
          >
            {testingMode === "free" ? "Testing..." : "Test All"}
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {freeEntries.map(([key, info]) => {
            // Dual-auth (e.g. kiro): count/toggle oauth + apikey/api_key so the
            // card total matches the provider detail page.
            const freeAuthTypes = dualAuthTypes(info, key);
            return (
              <ProviderCard
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, freeAuthTypes)}
                authType="free"
                onToggle={(active) =>
                  handleToggleProvider(key, freeAuthTypes, active)
                }
              />
            );
          })}
          {freeTierEntries.map(([key, info]) => {
            const freeAuthTypes = dualAuthTypes(info, key);
            return (
              <ApiKeyProviderCard
                key={key}
                providerId={key}
                provider={info}
                stats={getProviderStats(key, freeAuthTypes)}
                authType={Array.isArray(freeAuthTypes) ? (freeAuthTypes[0] ?? "apikey") : freeAuthTypes}
                onToggle={(active) => handleToggleProvider(key, freeAuthTypes, active)}
              />
            );
          })}
        </div>
      </div>
      )}

      {/* API Key Providers — fixed list */}
      {apikeyEntries.length > 0 && (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2 leading-tight">
            API Key Providers{" "}
          </h2>
          <Button
            variant="secondary"
            size="sm"
            icon="play_arrow"
            loading={testingMode === "apikey"}
            onClick={() => handleBatchTest("apikey")}
            disabled={!!testingMode}
            className="w-full sm:w-auto"
            title="Test all API Key connections"
            aria-label="Test all API Key connections"
          >
            {testingMode === "apikey" ? "Testing..." : "Test All"}
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {visibleApikeyEntries.map(([key, info]) => (
            <ApiKeyProviderCard
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, "apikey")}
              authType="apikey"
              onToggle={(active) => handleToggleProvider(key, "apikey", active)}
            />
          ))}
        </div>
        {!isApikeySearching && !showAllApikey && hiddenApikeyCount > 0 && (
          <button
            onClick={() => setShowAllApikey(true)}
            className="focus-ring flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-brand-line px-3 py-3 text-sm font-medium text-brand transition-colors duration-150 hover:border-brand hover:bg-brand-soft"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">expand_more</span>
            Show all {apikeyEntries.length} providers
          </button>
        )}
      </div>
      )}

      {/* Web Cookie Providers — use browser subscription cookie instead of API key */}
      {/* <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            Web Cookie Providers{" "}
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Object.entries(WEB_COOKIE_PROVIDERS).map(([key, info]) => (
            <ApiKeyProviderCard
              key={key}
              providerId={key}
              provider={info}
              stats={getProviderStats(key, "apikey")}
              authType="apikey"
              onToggle={(active) => handleToggleProvider(key, "apikey", active)}
            />
          ))}
        </div>
      </div> */}

      <AddCompatibleModal
        variant="openai"
        isOpen={showAddCompatibleModal}
        onClose={() => setShowAddCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddCompatibleModal(false);
        }}
      />
      <AddCompatibleModal
        variant="anthropic"
        isOpen={showAddAnthropicCompatibleModal}
        onClose={() => setShowAddAnthropicCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddAnthropicCompatibleModal(false);
        }}
      />
      <AddCompatibleModal
        variant="multi"
        isOpen={showAddMultiCompatibleModal}
        onClose={() => setShowAddMultiCompatibleModal(false)}
        onCreated={(node) => {
          setProviderNodes((prev) => [...prev, node]);
          setShowAddMultiCompatibleModal(false);
        }}
      />

      {/* Test Results Modal */}
      {testResults && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[6vh] sm:pt-[10vh]"
          onClick={() => setTestResults(null)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative bg-surface border border-border rounded-xl w-full max-w-[600px] max-h-[86vh] sm:max-h-[80vh] overflow-y-auto shadow-elev"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between px-5.5 py-3 border-b border-border bg-surface/95 backdrop-blur-sm rounded-t-xl">
              <h3 className="font-semibold">Test Results</h3>
              <Button
                variant="ghost" size="icon"
                onClick={() => setTestResults(null)}
                aria-label="Close test results"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-lg">close</span>
              </Button>
            </div>
            <div className="p-5.5">
              <ProviderTestResultsView results={testResults} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const FREE_SYNC_INTERVAL_OPTIONS = [
  { value: "4", label: "Every 4 hours" },
  { value: "8", label: "Every 8 hours" },
  { value: "12", label: "Every 12 hours" },
  { value: "24", label: "Every 24 hours" },
];

function FreeModelSyncCard() {
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const notify = useNotificationStore();

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/models/free-sync");
      if (res.ok) setStatus(await res.json());
    } catch (error) {
      console.log("Error fetching free-sync status:", error);
    }
  }, []);

  useEffect(() => {
    // Deferred so the first paint isn't blocked; not polled afterwards.
    const t = setTimeout(refreshStatus, 0);
    return () => clearTimeout(t);
  }, [refreshStatus]);

  const patchConfig = async (patch) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ freeModelSync: patch }),
      });
      if (res.ok) await refreshStatus();
    } catch (error) {
      console.log("Error updating free-model sync config:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleFetchNow = async () => {
    if (running) return;
    setRunning(true);
    try {
      const res = await fetch("/api/models/free-sync", { method: "POST" });
      const data = await res.json();
      if (res.ok && !data.error && !data.skipped)
        notify.success(`Free-model sync finished (+${data.added ?? 0} new, -${data.removed ?? 0} gone)`);
      else if (data.skipped) notify.warning("A sync is already running");
      else notify.error(data.error || "Free-model sync failed");
      await refreshStatus();
    } catch (error) {
      notify.error("Free-model sync failed");
    } finally {
      setRunning(false);
    }
  };

  const cfg = status?.config || { enabled: false, intervalHours: 4 };
  const providerEntries = Object.entries(status?.providers || {});
  const totalModels = providerEntries.reduce((n, [, p]) => n + (p.count || 0), 0);

  return (
    <Card padding="sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="size-9 shrink-0 rounded-lg bg-brand-soft flex items-center justify-center">
            <span aria-hidden="true" className="material-symbols-outlined text-brand text-[20px]">auto_awesome</span>
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold leading-tight">Auto-fetch free models</h3>
            <p className="text-xs text-text-muted mt-1">
              Discover free models on every free-tier provider and add them to tokenproxy.
              {totalModels > 0 && (
                <> Currently {totalModels} models across {providerEntries.length} providers.</>
              )}
              {status?.lastRunAt && <> Last run {getRelativeTime(status.lastRunAt)}.</>}
              {status?.lastError && <> <span className="text-danger">Last run failed.</span></>}
            </p>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:shrink-0">
          <Select
            aria-label="Free model sync interval"
            options={FREE_SYNC_INTERVAL_OPTIONS}
            value={String(cfg.intervalHours)}
            onChange={(e) => patchConfig({ ...cfg, intervalHours: Number(e.target.value) })}
            disabled={!cfg.enabled || saving}
            selectClassName="py-1.5 text-xs"
          />
          <Button
            variant="secondary"
            size="sm"
            icon="sync"
            loading={running}
            onClick={handleFetchNow}
            disabled={running}
            className="w-full sm:w-auto"
            title="Run a free-model sync immediately"
          >
            {running ? "Fetching..." : "Fetch now"}
          </Button>
          <Toggle
            checked={cfg.enabled}
            onChange={(v) => patchConfig({ ...cfg, enabled: v })}
            ariaLabel="Auto-fetch free models"
          />
        </div>
      </div>
    </Card>
  );
}

function ProviderCard({ providerId, provider, stats, authType, onToggle }) {
  const { allDisabled, latestErrorAt } = stats;
  const errorTime = latestErrorAt ? getRelativeTime(latestErrorAt) : null;
  const isNoAuth = !!provider.noAuth;

  return (
    <Link href={`/dashboard/providers/${providerId}`} className="group min-w-0">
      <Card
        padding="xs"
        className={`h-full hover:bg-surface-2 transition-colors duration-150 cursor-pointer ${allDisabled ? "opacity-50" : ""}`}
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="size-8 shrink-0 rounded-lg flex items-center justify-center"
              style={{
                backgroundColor: `${provider.color?.length > 7 ? provider.color : provider.color + "15"}`,
              }}
            >
              <ProviderIcon
                src={`/providers/${provider.id}.png`}
                alt={provider.name}
                size={30}
                className="object-contain rounded-lg max-w-[32px] max-h-[32px]"
                fallbackText={
                  provider.textIcon || provider.id.slice(0, 2).toUpperCase()
                }
                fallbackColor={provider.color}
              />
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-semibold" title={provider.name}>{provider.name}</h3>
              <div className="flex min-w-0 items-center gap-1.5 text-xs flex-wrap">
                {/* A no-auth provider needs no credential, so it is ready as
                    long as the operator has not switched it off. Disabled still
                    wins: "Ready" over a provider nothing routes to is the same
                    lie this route was fixed to stop telling. */}
                {isNoAuth && !allDisabled ? (
                  <StatusToken tone="ok">Ready</StatusToken>
                ) : (
                  <>
                    <ProviderStatusTokens summary={stats} />
                    {errorTime && (
                      <span className="text-text-muted">{errorTime}</span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {stats.total > 0 && (
              <div
                className="opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggle(!allDisabled ? false : true);
                }}
              >
                <Toggle
                  size="sm"
                  checked={!allDisabled}
                  onChange={() => {}}
                  title={`${allDisabled ? "Enable" : "Disable"} all ${provider.name} connections`}
                />
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

ProviderCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
  }).isRequired,
  stats: PropTypes.shape({
    total: PropTypes.number,
    connected: PropTypes.number,
    states: PropTypes.array,
    latestErrorAt: PropTypes.string,
    allDisabled: PropTypes.bool,
  }).isRequired,
  authType: PropTypes.string,
  onToggle: PropTypes.func,
};

function ApiKeyProviderCard({
  providerId,
  provider,
  stats,
  authType,
  onToggle,
}) {
  const { allDisabled, latestErrorAt } = stats;
  const errorTime = latestErrorAt ? getRelativeTime(latestErrorAt) : null;
  const isCompatible = providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
  const isAnthropicCompatible = providerId.startsWith(
    ANTHROPIC_COMPATIBLE_PREFIX,
  );

  const getIconPath = () => {
    if (provider.apiType === "multi") return null;
    if (isCompatible && provider.apiType)
      return provider.apiType === "responses"
        ? "/providers/oai-r.png"
        : "/providers/oai-cc.png";
    if (isAnthropicCompatible) return "/providers/anthropic-m.png";
    return getProviderIconSrc(provider.id);
  };

  return (
    <Link href={`/dashboard/providers/${providerId}`} className="group min-w-0">
      <Card
        padding="xs"
        className={`h-full hover:bg-surface-2 transition-colors duration-150 cursor-pointer ${allDisabled ? "opacity-50" : ""}`}
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="size-8 shrink-0 rounded-lg flex items-center justify-center"
              style={{
                backgroundColor: `${provider.color?.length > 7 ? provider.color : provider.color + "15"}`,
              }}
            >
              <ProviderIcon
                src={getIconPath()}
                alt={provider.name}
                size={30}
                className="object-contain rounded-lg max-w-[30px] max-h-[30px]"
                fallbackText={
                  provider.textIcon || provider.id.slice(0, 2).toUpperCase()
                }
                fallbackColor={provider.color}
              />
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-semibold" title={provider.name}>{provider.name}</h3>
              <div className="flex min-w-0 items-center gap-1.5 text-xs flex-wrap">
                <ProviderStatusTokens summary={stats} />
                {isCompatible && (
                  <Badge variant="default" size="sm">
                    {provider.apiType === "multi"
                      ? "Chat + Messages"
                      : provider.apiType === "responses"
                        ? "Responses"
                        : "Chat"}
                  </Badge>
                )}
                {isAnthropicCompatible && (
                  <Badge variant="default" size="sm">
                    Messages
                  </Badge>
                )}
                {errorTime && (
                  <span className="text-text-muted">{errorTime}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {stats.total > 0 && (
              <div
                className="opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggle(!allDisabled ? false : true);
                }}
              >
                <Toggle
                  size="sm"
                  checked={!allDisabled}
                  onChange={() => {}}
                  title={`${allDisabled ? "Enable" : "Disable"} all ${provider.name} connections`}
                />
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

ApiKeyProviderCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    color: PropTypes.string,
    textIcon: PropTypes.string,
    apiType: PropTypes.string,
  }).isRequired,
  stats: PropTypes.shape({
    total: PropTypes.number,
    connected: PropTypes.number,
    states: PropTypes.array,
    latestErrorAt: PropTypes.string,
    allDisabled: PropTypes.bool,
  }).isRequired,
  authType: PropTypes.string,
  onToggle: PropTypes.func,
};

function ProviderTestResultsView({ results }) {
  if (results.error && !results.results) {
    return (
      <div className="text-center py-5.5">
        <span aria-hidden="true" className="material-symbols-outlined text-danger text-[32px] mb-2 block">
          error
        </span>
        <p className="text-sm text-danger">{results.error}</p>
      </div>
    );
  }

  const { summary, mode } = results;
  const items = results.results || [];
  const modeLabel =
    {
      oauth: "OAuth",
      free: "Free",
      apikey: "API Key",
      provider: "Provider",
      all: "All",
    }[mode] || mode;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {summary && (
        <div className="flex flex-wrap items-center gap-2 text-xs mb-1 sm:gap-3">
          <span className="text-text-muted">{modeLabel} Test</span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-success-soft text-success font-medium">
            <span className="material-symbols-outlined text-[12px] leading-none" aria-hidden="true">check_circle</span>
            <span className="metric">{summary.passed}</span> passed
          </span>
          {summary.failed > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-danger-soft text-danger font-medium">
              <span className="material-symbols-outlined text-[12px] leading-none" aria-hidden="true">error</span>
              <span className="metric">{summary.failed}</span> failed
            </span>
          )}
          <span className="text-text-muted sm:ms-auto">
            <span className="metric">{summary.total}</span> tested
          </span>
        </div>
      )}
      {items.map((r, i) => (
        <div
          key={r.connectionId || i}
          className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs sm:flex-nowrap"
        >
          <span aria-hidden="true"
            className={`material-symbols-outlined text-[16px] ${r.valid ? "text-success" : "text-danger"}`}
          >
            {r.valid ? "check_circle" : "error"}
          </span>
          <div className="min-w-0 flex-[1_1_160px]">
            <span className="block truncate font-medium sm:inline">
              {r.connectionName}
            </span>
            <span className="block truncate text-text-muted sm:ms-1.5 sm:inline">
              ({r.provider})
            </span>
          </div>
          {r.latencyMs !== undefined && (
            <span className="shrink-0 text-text-muted font-mono metric">
              {r.latencyMs}ms
            </span>
          )}
          <span
            className={`shrink-0 font-mono text-xs font-bold px-1.5 py-1 rounded ${
              r.valid
                ? "bg-success-soft text-success"
                : "bg-danger-soft text-danger"
            }`}
          >
            {r.valid ? "OK" : r.diagnosis?.type || "ERROR"}
          </span>
        </div>
      ))}
      {items.length === 0 && (
        <div className="text-center py-4 text-text-muted text-sm">
          No active connections found for this group.
        </div>
      )}
    </div>
  );
}

ProviderTestResultsView.propTypes = {
  results: PropTypes.shape({
    mode: PropTypes.string,
    results: PropTypes.array,
    summary: PropTypes.shape({
      total: PropTypes.number,
      passed: PropTypes.number,
      failed: PropTypes.number,
    }),
    error: PropTypes.string,
  }).isRequired,
};
