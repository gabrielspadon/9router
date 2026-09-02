import { getProxyPoolById } from "@/models";
import { normalizeProxyUrl } from "@/shared/utils/proxyUrl.js";

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function hasOwn(data, key) {
  return Object.prototype.hasOwnProperty.call(data || {}, key);
}

function requiredUnavailable(reason, proxyPoolId = null, strictProxy = true) {
  return {
    kind: "required-unavailable",
    resolutionKind: "required-unavailable",
    reason,
    proxyPoolId,
    strictProxy: strictProxy === true,
  };
}

function usableConfigFromPool(proxyPool, pair) {
  const isRelay = proxyPool.type === "vercel" || proxyPool.type === "cloudflare";
  return {
    kind: "usable",
    resolutionKind: "selected-proxy",
    source: "pool",
    proxyPoolId: pair.proxyPoolId,
    proxyPool,
    connectionProxyEnabled: !isRelay,
    connectionProxyUrl: isRelay ? "" : proxyPool.proxyUrl,
    connectionNoProxy: normalizeString(proxyPool.noProxy),
    vercelRelayUrl: isRelay ? proxyPool.proxyUrl : "",
    strictProxy: pair.strictProxy === true,
  };
}

function normalizeLegacyProxy(data = {}) {
  const connectionProxyMode = normalizeString(data.connectionProxyMode);
  const connectionProxyUrl = normalizeString(data.connectionProxyUrl);
  const connectionNoProxy = normalizeString(data.connectionNoProxy);
  const hasStrictProxy = hasOwn(data, "strictProxy");
  const strictProxyTypeValid = !hasStrictProxy || typeof data.strictProxy === "boolean";
  const strictProxy = data.strictProxy === true;
  const hasLegacyProxyFields = [
    "connectionProxyEnabled", "connectionProxyUrl", "connectionNoProxy", "strictProxy",
  ].some((key) => hasOwn(data, key));
  return {
    connectionProxyMode,
    hasLegacyProxyFields,
    hasConnectionProxyEnabled: hasOwn(data, "connectionProxyEnabled"),
    connectionProxyEnabled: data.connectionProxyEnabled === true,
    connectionProxyUrl,
    connectionNoProxy,
    strictProxy,
    strictProxyTypeValid,
    isHistoricalDefaultFalseTuple: connectionProxyMode === ""
      && data.connectionProxyEnabled === false
      && connectionProxyUrl === ""
      && connectionNoProxy === ""
      && (!hasStrictProxy || data.strictProxy === false),
  };
}

function usableLegacyConfig(legacy) {
  if (legacy.connectionProxyMode === "direct") {
    if (legacy.hasLegacyProxyFields) {
      return requiredUnavailable("connection-proxy-direct-conflict", null, legacy.strictProxy);
    }
    return {
      kind: "usable",
      resolutionKind: "intentional-direct",
      source: "legacy",
      reason: "connection-proxy-direct",
      proxyPoolId: null,
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
      vercelRelayUrl: "",
      strictProxy: false,
    };
  }
  if (legacy.connectionProxyMode && legacy.connectionProxyMode !== "proxy") {
    return requiredUnavailable("connection-proxy-mode-invalid", null, legacy.strictProxy);
  }
  if (!legacy.strictProxyTypeValid) {
    return requiredUnavailable("legacy-proxy-strict-invalid", null, false);
  }
  if (legacy.isHistoricalDefaultFalseTuple) return null;
  if (!legacy.hasLegacyProxyFields && legacy.connectionProxyMode === "") return null;
  if (!legacy.hasConnectionProxyEnabled) {
    return requiredUnavailable("legacy-proxy-enabled-missing", null, legacy.strictProxy);
  }
  if (legacy.connectionProxyEnabled !== true) {
    return requiredUnavailable("legacy-proxy-disabled-ambiguous", null, legacy.strictProxy);
  }
  // Normalise, do not merely validate. Accepting a shorthand and then passing the
  // RAW string downstream would hand "host:port:user:pass" to the proxy agent.
  const legacyProxyUrl = normalizeProxyUrl(legacy.connectionProxyUrl);
  if (!legacyProxyUrl) {
    return requiredUnavailable("legacy-proxy-invalid", null, legacy.strictProxy);
  }
  return {
    kind: "usable",
    resolutionKind: "selected-proxy",
    source: "legacy",
    proxyPoolId: null,
    connectionProxyEnabled: true,
    connectionProxyUrl: legacyProxyUrl,
    connectionNoProxy: legacy.connectionNoProxy,
    vercelRelayUrl: "",
    strictProxy: legacy.strictProxy,
  };
}

const rotateState = new Map();

export function pickProxyPoolId(poolIds, strategy, providerId) {
  if (!poolIds || poolIds.length === 0) return null;
  if (poolIds.length === 1) return poolIds[0];
  if (strategy === "round-robin") {
    const state = rotateState.get(providerId) || { index: -1 };
    state.index = (state.index + 1) % poolIds.length;
    rotateState.set(providerId, state);
    return poolIds[state.index];
  }
  if (strategy === "random") return poolIds[Math.floor(Math.random() * poolIds.length)];
  return poolIds[0];
}

export class RequiredProxyUnavailableError extends Error {
  constructor(reason) {
    super("Required proxy is unavailable");
    this.name = "RequiredProxyUnavailableError";
    this.code = "required_proxy_unavailable";
    this.status = 503;
    this.reason = reason;
  }
}

export const isRequiredProxyUnavailableError = (error) => error?.code === "required_proxy_unavailable";

export function toConnectionProxyOptions(config) {
  if (config?.kind !== "usable") throw new RequiredProxyUnavailableError(config?.reason);
  return {
    connectionProxyEnabled: config.connectionProxyEnabled === true,
    connectionProxyUrl: config.connectionProxyUrl || "",
    connectionNoProxy: config.connectionNoProxy || "",
    vercelRelayUrl: config.vercelRelayUrl || "",
    strictProxy: config.strictProxy === true,
    resolutionKind: config.resolutionKind,
  };
}

/**
 * Resolve persisted proxy selection without downgrading a selected route to
 * environment policy or direct egress when the selection cannot be trusted.
 */
export async function resolveConnectionProxyConfig(data = {}, { persistPoolSnapshot } = {}) {
  const proxyPoolIdRaw = normalizeString(data.proxyPoolId);
  if (proxyPoolIdRaw === "__none__") {
    return {
      kind: "usable",
      resolutionKind: "intentional-direct",
      source: "legacy-pool-none",
      reason: "pool-none",
      proxyPoolId: null,
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
      vercelRelayUrl: "",
      strictProxy: false,
    };
  }

  if (proxyPoolIdRaw) {
    const storedStrict = data.strictProxy;
    let proxyPool;
    try {
      proxyPool = await getProxyPoolById(proxyPoolIdRaw);
    } catch {
      return requiredUnavailable("selected-pool-unavailable", proxyPoolIdRaw, storedStrict === true);
    }
    const proxyUrl = normalizeProxyUrl(normalizeString(proxyPool?.proxyUrl));
    const activePool = proxyPool && proxyPool.isActive === true && proxyUrl
      ? { ...proxyPool, proxyUrl }
      : null;
    if (!activePool) {
      return requiredUnavailable("selected-pool-unavailable", proxyPoolIdRaw, storedStrict === true);
    }
    if (typeof storedStrict !== "boolean") {
      if (typeof persistPoolSnapshot !== "function") {
        return requiredUnavailable("legacy-pool-snapshot-unavailable", proxyPoolIdRaw);
      }
      const pair = { proxyPoolId: proxyPoolIdRaw, strictProxy: activePool.strictProxy === true };
      try {
        if (!await persistPoolSnapshot(pair)) {
          return requiredUnavailable("legacy-pool-snapshot-unavailable", proxyPoolIdRaw, pair.strictProxy);
        }
      } catch {
        return requiredUnavailable("legacy-pool-snapshot-unavailable", proxyPoolIdRaw, pair.strictProxy);
      }
      return usableConfigFromPool(activePool, pair);
    }
    return usableConfigFromPool(activePool, { proxyPoolId: proxyPoolIdRaw, strictProxy: storedStrict });
  }

  const legacy = normalizeLegacyProxy(data);
  if (legacy.isHistoricalDefaultFalseTuple) {
    return {
      kind: "usable",
      resolutionKind: "unselected",
      source: "legacy-default",
      proxyPoolId: null,
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
      vercelRelayUrl: "",
      strictProxy: false,
    };
  }
  const legacyResult = usableLegacyConfig(legacy);
  if (legacyResult) return legacyResult;
  return {
    kind: "usable",
    resolutionKind: "unselected",
    source: "none",
    proxyPoolId: null,
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
    vercelRelayUrl: "",
    strictProxy: false,
  };
}
