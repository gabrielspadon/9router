import { NextResponse } from "next/server";
import {
  getProviderConnections,
  createProviderConnection,
  getProviderNodeById,
  getProviderNodes,
  getProxyPoolById,
} from "@/models";
import { APIKEY_PROVIDERS, FREE_PROVIDERS } from "@/shared/constants/config";
import { AI_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider } from "@/shared/constants/providers";
import { normalizeProviderId, normalizeProviderSpecificData, redactConnectionSecrets } from "@/lib/providerNormalization";

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

// #2504: a built-in API-key provider can be pointed at a different endpoint of
// the same API — Kimi's coding plan, Volcengine Ark's token plan — instead of
// each plan needing its own registry entry and icon. The override is stored
// where the openai-compatible nodes already keep theirs, so nothing new has to
// learn to read it. An absent field leaves the registry default in place; an
// empty one clears a previous override.
const ENDPOINT_API_TYPES = new Set(["chat", "responses"]);

// The dashboard sends this field nested for the providers that already declare
// a baseUrlField, and flat is the shape the API-key form has to use, so both
// are read here rather than making one of the two callers wrap its value.
function readEndpointField(body, key) {
  if (hasOwn(body, key)) return { present: true, value: body[key] };
  const nested = body?.providerSpecificData;
  if (nested && typeof nested === "object" && hasOwn(nested, key)) {
    return { present: true, value: nested[key] };
  }
  return { present: false };
}

function normalizeEndpointOverride(body = {}, stored = null) {
  const override = {};
  const base = readEndpointField(body, "baseUrl");
  if (base.present) {
    const baseUrl = normalizeString(base.value);
    // Checked here rather than where it is fetched: a bare host or a non-http
    // scheme stored now surfaces much later as an unexplained connection
    // failure. A value identical to the stored one is an echo from a form that
    // re-submits every field, not a change — rejecting that would lock an
    // operator out of editing anything else on a connection written before
    // this check existed.
    if (baseUrl && baseUrl !== normalizeString(stored?.baseUrl)) {
      let parsed = null;
      try { parsed = new URL(baseUrl); } catch { parsed = null; }
      if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
        return { error: "Base URL must be an absolute http:// or https:// URL" };
      }
    }
    override.baseUrl = baseUrl ? baseUrl.replace(/\/$/, "") : null;
  }
  const type = readEndpointField(body, "apiType");
  if (type.present) {
    const apiType = normalizeString(type.value);
    if (apiType && apiType !== normalizeString(stored?.apiType) && !ENDPOINT_API_TYPES.has(apiType)) {
      return { error: "API type must be chat or responses" };
    }
    override.apiType = apiType || null;
  }
  return { override };
}

function applyEndpointOverride(data, override) {
  const next = { ...(data || {}) };
  for (const [key, value] of Object.entries(override || {})) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
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

// GET /api/providers - List connections, optionally narrowed to one provider
export async function GET(request) {
  try {
    // #2998: the provider detail page fetched the whole connection table on
    // every visit and discarded everything belonging to another provider. The
    // repository has always accepted this filter, so push it down rather than
    // pay to redact rows nobody reads. Normalized the same way POST normalizes
    // a write, or an alias spelling would silently answer with an empty list.
    // No parameter still means the whole list, which every other caller wants.
    const requested = request?.url ? new URL(request.url).searchParams.get("provider")?.trim() : null;
    const connections = await getProviderConnections(
      requested ? { provider: normalizeProviderId(requested) } : {}
    );

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
      return redactConnectionSecrets({ ...c, name });
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
      FREE_PROVIDERS[provider] ||
      supportsApiKeyMode ||
      isWebCookieProvider ||
      isOpenAICompatibleProvider(provider) ||
      isAnthropicCompatibleProvider(provider) ||
      isCustomEmbeddingProvider(provider);

    if (!provider || !isValidProvider) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
    // A custom OpenAI/Anthropic-compatible endpoint may legitimately take no
    // credential (a local proxy, an internal gateway). Requiring one forced a
    // dummy key that was then SENT to that endpoint, which is what the report
    // asked to stop doing (#1523). Only the compatible prefixes are exempt: a
    // named provider with an empty key is still a mistake worth catching.
    const allowsEmptyApiKey =
      provider === "ollama-local" ||
      isOpenAICompatibleProvider(provider) ||
      isAnthropicCompatibleProvider(provider);
    if (!apiKey && !allowsEmptyApiKey) {
      const needsCookie = isWebCookieProvider || AI_PROVIDERS[provider]?.authType === "cookie";
      return NextResponse.json({ error: `${needsCookie ? "Cookie value" : "API Key"} is required` }, { status: 400 });
    }
    const connectionName = name || displayName || AI_PROVIDERS[provider]?.name;
    if (!connectionName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    let providerSpecificData = normalizeProviderSpecificData(provider, body, body.providerSpecificData);

    // A compatible or custom-embedding connection takes its endpoint from its
    // provider node below, so the client cannot name one for those; every other
    // provider may override the registry default per connection (#2504).
    const usesNodeEndpoint = isOpenAICompatibleProvider(provider)
      || isAnthropicCompatibleProvider(provider)
      || isCustomEmbeddingProvider(provider);
    if (!usesNodeEndpoint) {
      const endpointResult = normalizeEndpointOverride(body);
      if (endpointResult.error) {
        return NextResponse.json({ error: endpointResult.error }, { status: 400 });
      }
      if (Object.keys(endpointResult.override).length) {
        providerSpecificData = applyEndpointOverride(providerSpecificData, endpointResult.override);
      }
    }

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
      authType: isWebCookieProvider || AI_PROVIDERS[provider]?.authType === "cookie" ? "cookie" : "apikey",
      name: connectionName,
      apiKey: apiKey || "",
      priority: priority || 1,
      globalPriority: globalPriority || null,
      defaultModel: defaultModel || null,
      providerSpecificData: mergedProviderSpecificData,
      isActive: true,
      testStatus: testStatus || "unknown",
    });

    return NextResponse.json({ connection: redactConnectionSecrets(newConnection) }, { status: 201 });
  } catch (error) {
    console.log("Error creating provider:", error);
    return NextResponse.json({ error: "Failed to create provider" }, { status: 500 });
  }
}
