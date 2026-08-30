import { NextResponse } from "next/server";
import {
  getProviderConnectionById,
  getProxyPoolById,
  updateProviderConnection,
  deleteProviderConnection,
} from "@/models";

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

function isHistoricalDefaultTuple(data) {
  return !hasOwn(data, "connectionProxyMode")
    && data.connectionProxyEnabled === false
    && normalizeString(data.connectionProxyUrl) === ""
    && normalizeString(data.connectionNoProxy) === ""
    && (!hasOwn(data, "strictProxy") || data.strictProxy === false);
}

function clearHistoricalDefaultTuple(data) {
  if (!isHistoricalDefaultTuple(data)) return;
  delete data.connectionProxyEnabled;
  delete data.connectionProxyUrl;
  delete data.connectionNoProxy;
  if (!hasOwn(data, "proxyPoolId")) delete data.strictProxy;
}

// GET /api/providers/[id] - Get single connection
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    // Hide sensitive fields
    const result = { ...connection };
    delete result.apiKey;
    delete result.accessToken;
    delete result.refreshToken;
    delete result.idToken;

    return NextResponse.json({ connection: result });
  } catch (error) {
    console.log("Error fetching connection:", error);
    return NextResponse.json({ error: "Failed to fetch connection" }, { status: 500 });
  }
}

// PUT /api/providers/[id] - Update connection
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      name,
      priority,
      globalPriority,
      defaultModel,
      isActive,
      apiKey,
      testStatus,
      lastError,
      lastErrorAt,
      providerSpecificData,
      quotaPauseThresholds
    } = body;

    const existing = await getProviderConnectionById(id);
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const proxyConfig = normalizeConnectionProxyWrite(body);
    if (proxyConfig.error) {
      return NextResponse.json({ error: proxyConfig.error }, { status: 400 });
    }

    const proxyPoolResult = await normalizeSelectedPool(body);
    if (proxyPoolResult.error) {
      return NextResponse.json({ error: proxyPoolResult.error }, { status: 400 });
    }
    if (proxyPoolResult.mode === "pool" && proxyConfig.mode !== "omit") {
      return NextResponse.json({ error: "Proxy pool selection cannot include connection proxy fields" }, { status: 400 });
    }
    if (proxyPoolResult.mode === "direct" && proxyConfig.mode !== "omit") {
      return NextResponse.json({ error: "Direct proxy-pool selection cannot include connection proxy fields" }, { status: 400 });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (priority !== undefined) updateData.priority = priority;
    if (globalPriority !== undefined) updateData.globalPriority = globalPriority;
    if (defaultModel !== undefined) updateData.defaultModel = defaultModel;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (apiKey && existing.authType === "apikey") updateData.apiKey = apiKey;
    if (testStatus !== undefined) updateData.testStatus = testStatus;
    if (lastError !== undefined) updateData.lastError = lastError;
    if (lastErrorAt !== undefined) updateData.lastErrorAt = lastErrorAt;
    // Per-account quota safety buffer: pause routing when a specific quota window's
    // remaining % drops to/below its configured threshold. Map of windowKey -> %,
    // 0/undefined disables that window. Stored in the connection's data blob.
    if (quotaPauseThresholds !== undefined) {
      const clean = {};
      if (quotaPauseThresholds && typeof quotaPauseThresholds === "object") {
        for (const [key, val] of Object.entries(quotaPauseThresholds)) {
          const t = Number(val);
          if (Number.isFinite(t) && t > 0 && t <= 100) clean[key] = t;
        }
      }
      updateData.quotaPauseThresholds = clean;
    }

    if (existing.providerSpecificData !== undefined
        || providerSpecificData !== undefined
        || proxyConfig.mode !== "omit"
        || proxyPoolResult.hasProxyPoolField) {
      updateData.providerSpecificData = {
        ...(existing.providerSpecificData || {}),
        ...stripReservedProxyFields(providerSpecificData),
      };

      if (proxyPoolResult.mode === "direct" || proxyConfig.mode === "direct") {
        applyExplicitDirectSelection(updateData.providerSpecificData);
      } else if (proxyPoolResult.mode === "pool") {
        applySelection(updateData.providerSpecificData, proxyPoolResult);
      } else if (proxyPoolResult.hasProxyPoolField) {
        applySelection(updateData.providerSpecificData, proxyPoolResult);
      } else if (proxyConfig.mode === "proxy") {
        applySelection(updateData.providerSpecificData, { mode: "unselected" });
        applyConnectionProxyWrite(updateData.providerSpecificData, proxyConfig);
      } else if (providerSpecificData !== undefined) {
        clearHistoricalDefaultTuple(updateData.providerSpecificData);
      }
    }

    const updated = await updateProviderConnection(id, updateData);

    // Hide sensitive fields
    const result = { ...updated };
    delete result.apiKey;
    delete result.accessToken;
    delete result.refreshToken;
    delete result.idToken;

    return NextResponse.json({ connection: result });
  } catch (error) {
    console.log("Error updating connection:", error);
    return NextResponse.json({ error: "Failed to update connection" }, { status: 500 });
  }
}

// DELETE /api/providers/[id] - Delete connection
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteProviderConnection(id);
    if (!deleted) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Connection deleted successfully" });
  } catch (error) {
    console.log("Error deleting connection:", error);
    return NextResponse.json({ error: "Failed to delete connection" }, { status: 500 });
  }
}
