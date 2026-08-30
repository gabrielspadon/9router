import { NextResponse } from "next/server";
import {
  getProviderConnections,
  createProviderConnection,
  getProviderNodeById,
  getProviderNodes,
  getProxyPoolById,
} from "@/models";
import { APIKEY_PROVIDERS } from "@/shared/constants/config";
import { AI_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider } from "@/shared/constants/providers";
import { normalizeProviderId, normalizeProviderSpecificData } from "@/lib/providerNormalization";

export const dynamic = "force-dynamic";

const RESERVED_PROXY_FIELDS = [
  "connectionProxyMode",
  "connectionProxyEnabled",
  "connectionProxyUrl",
  "connectionNoProxy",
  "proxyPoolId",
  "strictProxy",
];
const SUPPORTED_PROVIDER_PROXY_SCHEMES = new Set([
  "http:", "https:", "socks:", "socks4:", "socks4a:", "socks5:", "socks5h:",
]);

function hasOwn(data, key) {
  return Object.prototype.hasOwnProperty.call(data || {}, key);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isSupportedProviderProxyUrl(url) {
  try {
    return SUPPORTED_PROVIDER_PROXY_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function normalizeConnectionProxyWrite(body = {}) {
  if (hasOwn(body, "connectionProxyMode") || hasOwn(body, "strictProxy")) {
    return { error: "Connection proxy policy is server-managed" };
  }
  const hasEnabled = hasOwn(body, "connectionProxyEnabled");
  const hasUrl = hasOwn(body, "connectionProxyUrl");
  const hasNoProxy = hasOwn(body, "connectionNoProxy");
  if (!hasEnabled && !hasUrl && !hasNoProxy) return { mode: "omit" };
  if (body.connectionProxyEnabled === false) {
    if (hasUrl || hasNoProxy) return { error: "Connection direct policy cannot include proxy URL or no-proxy" };
    return { mode: "direct" };
  }
  const url = normalizeString(body.connectionProxyUrl);
  const noProxy = normalizeString(body.connectionNoProxy);
  if (body.connectionProxyEnabled !== true || !url || !isSupportedProviderProxyUrl(url)) {
    return { error: "Connection proxy requires an enabled supported proxy URL" };
  }
  return { mode: "proxy", url, ...(noProxy ? { noProxy } : {}) };
}

async function normalizeSelectedPool(body = {}) {
  if (!hasOwn(body, "proxyPoolId")) return { hasProxyPoolField: false, mode: "unselected" };
  if (body.proxyPoolId === "__none__") {
    return { hasProxyPoolField: true, mode: "direct" };
  }
  if (body.proxyPoolId === undefined || body.proxyPoolId === null || body.proxyPoolId === "") {
    return { hasProxyPoolField: true, mode: "unselected" };
  }
  const proxyPoolId = String(body.proxyPoolId).trim();
  if (!proxyPoolId) return { hasProxyPoolField: true, mode: "unselected" };
  const proxyPool = await getProxyPoolById(proxyPoolId);
  if (!proxyPool?.isActive || !normalizeString(proxyPool.proxyUrl)) {
    return { error: "Active proxy pool not found" };
  }
  return {
    hasProxyPoolField: true,
    mode: "pool",
    proxyPoolId: proxyPool.id,
    strictProxy: proxyPool.strictProxy === true,
  };
}

function stripReservedProxyFields(data) {
  const sanitized = { ...(data || {}) };
  for (const key of RESERVED_PROXY_FIELDS) delete sanitized[key];
  return sanitized;
}

function applySelection(data, selection) {
  if (selection.mode === "pool") {
    data.proxyPoolId = selection.proxyPoolId;
    data.strictProxy = selection.strictProxy;
    return;
  }
  delete data.proxyPoolId;
  delete data.strictProxy;
}

function applyConnectionProxyWrite(data, config) {
  for (const key of ["connectionProxyMode", "connectionProxyEnabled", "connectionProxyUrl", "connectionNoProxy", "strictProxy"]) {
    delete data[key];
  }
  if (config.mode === "proxy") {
    Object.assign(data, {
      connectionProxyMode: "proxy",
      connectionProxyEnabled: true,
      connectionProxyUrl: config.url,
      ...(config.noProxy ? { connectionNoProxy: config.noProxy } : {}),
    });
  } else if (config.mode === "direct") {
    data.connectionProxyMode = "direct";
  }
}

function applyExplicitDirectSelection(data) {
  applySelection(data, { mode: "unselected" });
  applyConnectionProxyWrite(data, { mode: "direct" });
}

// GET /api/providers - List all connections
export async function GET() {
  try {
    const connections = await getProviderConnections();

    // Build nodeNameMap for compatible providers (id → name)
    let nodeNameMap = {};
    try {
      const nodes = await getProviderNodes();
      for (const node of nodes) {
        if (node.id && node.name) nodeNameMap[node.id] = node.name;
      }
    } catch { }

    // Hide sensitive fields, enrich name for compatible providers
    const safeConnections = connections.map(c => {
      const isCompatible = isOpenAICompatibleProvider(c.provider) || isAnthropicCompatibleProvider(c.provider);
      const name = isCompatible
        ? (c.name || nodeNameMap[c.provider] || c.providerSpecificData?.nodeName || c.provider)
        : c.name;
      return {
        ...c,
        name,
        apiKey: undefined,
        accessToken: undefined,
        refreshToken: undefined,
        idToken: undefined,
      };
    });

    return NextResponse.json({ connections: safeConnections });
  } catch (error) {
    console.log("Error fetching providers:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}

// POST /api/providers - Create new connection (API Key only, OAuth via separate flow)
export async function POST(request) {
  try {
    const body = await request.json();
    const provider = normalizeProviderId(body.provider);
    const { apiKey, name, displayName, priority, globalPriority, defaultModel, testStatus } = body;
    const proxyConfig = normalizeConnectionProxyWrite(body);
    if (proxyConfig.error) return NextResponse.json({ error: proxyConfig.error }, { status: 400 });
    const proxyPoolResult = await normalizeSelectedPool(body);
    if (proxyPoolResult.error) return NextResponse.json({ error: proxyPoolResult.error }, { status: 400 });
    if (proxyPoolResult.mode === "pool" && proxyConfig.mode !== "omit") {
      return NextResponse.json({ error: "Proxy pool selection cannot include connection proxy fields" }, { status: 400 });
    }
    if (proxyPoolResult.mode === "direct" && proxyConfig.mode !== "omit") {
      return NextResponse.json({ error: "Direct proxy-pool selection cannot include connection proxy fields" }, { status: 400 });
    }

    // Validation
    const isWebCookieProvider = !!WEB_COOKIE_PROVIDERS[provider];
    // Dual-auth providers (e.g. codebuddy-cn, xai) live under category "oauth" but also
    // accept an API key via authModes — they aren't in APIKEY_PROVIDERS, so allow them here.
    const supportsApiKeyMode = !!AI_PROVIDERS[provider]?.authModes?.includes("apikey");
    const isValidProvider = APIKEY_PROVIDERS[provider] ||
      FREE_TIER_PROVIDERS[provider] ||
      supportsApiKeyMode ||
      isWebCookieProvider ||
      isOpenAICompatibleProvider(provider) ||
      isAnthropicCompatibleProvider(provider) ||
      isCustomEmbeddingProvider(provider);

    if (!provider || !isValidProvider) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
    if (!apiKey && provider !== "ollama-local") {
      return NextResponse.json({ error: `${isWebCookieProvider ? "Cookie value" : "API Key"} is required` }, { status: 400 });
    }
    const connectionName = name || displayName || AI_PROVIDERS[provider]?.name;
    if (!connectionName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    let providerSpecificData = normalizeProviderSpecificData(provider, body, body.providerSpecificData);

    // Compatible LLM nodes support multiple API-key connections (key pool); runtime
    // rotates/fails over via getProviderCredentials. Embedding nodes stay single-connection.
    if (isOpenAICompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "OpenAI Compatible node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        apiType: node.apiType,
        baseUrl: node.baseUrl,
        nodeName: node.name,
        ...(Array.isArray(node.transports) ? { transports: node.transports } : {}),
      };
    } else if (isAnthropicCompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "Anthropic Compatible node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    } else if (isCustomEmbeddingProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "Custom Embedding node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    }

    const mergedProviderSpecificData = stripReservedProxyFields(providerSpecificData);
    if (proxyPoolResult.mode === "direct" || proxyConfig.mode === "direct") {
      applyExplicitDirectSelection(mergedProviderSpecificData);
    } else if (proxyPoolResult.mode === "pool") {
      applySelection(mergedProviderSpecificData, proxyPoolResult);
    } else if (proxyConfig.mode === "proxy") {
      applySelection(mergedProviderSpecificData, { mode: "unselected" });
      applyConnectionProxyWrite(mergedProviderSpecificData, proxyConfig);
    }

    const newConnection = await createProviderConnection({
      provider,
      authType: isWebCookieProvider ? "cookie" : "apikey",
      name: connectionName,
      apiKey: apiKey || "",
      priority: priority || 1,
      globalPriority: globalPriority || null,
      defaultModel: defaultModel || null,
      providerSpecificData: mergedProviderSpecificData,
      isActive: true,
      testStatus: testStatus || "unknown",
    });

    // Hide sensitive fields
    const result = { ...newConnection };
    delete result.apiKey;

    return NextResponse.json({ connection: result }, { status: 201 });
  } catch (error) {
    console.log("Error creating provider:", error);
    return NextResponse.json({ error: "Failed to create provider" }, { status: 500 });
  }
}
