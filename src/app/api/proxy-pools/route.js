import { NextResponse } from "next/server";
import { createProxyPool, deleteProxyPool, getProviderConnections, getProxyPools } from "@/models";

function toBoolean(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

const VALID_PROXY_TYPES = ["http", "vercel", "cloudflare"];

function normalizeProxyPoolInput(body = {}) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const proxyUrl = typeof body?.proxyUrl === "string" ? body.proxyUrl.trim() : "";
  const noProxy = typeof body?.noProxy === "string" ? body.noProxy.trim() : "";
  const isActive = body?.isActive === undefined ? true : body.isActive === true;
  const strictProxy = body?.strictProxy === true;
  const type = VALID_PROXY_TYPES.includes(body?.type) ? body.type : "http";

  if (!name) {
    return { error: "Name is required" };
  }

  if (!proxyUrl) {
    return { error: "Proxy URL is required" };
  }

  return { name, proxyUrl, noProxy, isActive, strictProxy, type };
}

function buildUsageMap(connections = []) {
  const usageMap = new Map();

  for (const connection of connections) {
    const proxyPoolId = connection?.providerSpecificData?.proxyPoolId;
    if (!proxyPoolId) continue;

    usageMap.set(proxyPoolId, (usageMap.get(proxyPoolId) || 0) + 1);
  }

  return usageMap;
}

// GET /api/proxy-pools - List proxy pools
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const isActive = toBoolean(searchParams.get("isActive"));
    const includeUsage = searchParams.get("includeUsage") === "true";

    const filter = {};
    if (isActive !== undefined) {
      filter.isActive = isActive;
    }

    const proxyPools = await getProxyPools(filter);

    if (!includeUsage) {
      return NextResponse.json({ proxyPools });
    }

    const connections = await getProviderConnections();
    const usageMap = buildUsageMap(connections);

    const enrichedProxyPools = proxyPools.map((pool) => ({
      ...pool,
      boundConnectionCount: usageMap.get(pool.id) || 0,
    }));

    return NextResponse.json({ proxyPools: enrichedProxyPools });
  } catch (error) {
    console.log("Error fetching proxy pools:", error);
    return NextResponse.json({ error: "Failed to fetch proxy pools" }, { status: 500 });
  }
}

// POST /api/proxy-pools - Create proxy pool
export async function POST(request) {
  try {
    const body = await request.json();
    const normalized = normalizeProxyPoolInput(body);

    if (normalized.error) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const proxyPool = await createProxyPool(normalized);
    return NextResponse.json({ proxyPool }, { status: 201 });
  } catch (error) {
    console.log("Error creating proxy pool:", error);
    return NextResponse.json({ error: "Failed to create proxy pool" }, { status: 500 });
  }
}

// DELETE /api/proxy-pools  body: { ids: [...] }
// Cleaning up after a bulk import or a failed test round meant one request per
// proxy, and the report's own case is a pool where many are disabled at once
// (#3400). A pool still bound to a connection is refused for the same reason the
// single delete refuses it, and refusing one member must not abandon the rest,
// so the result is per id rather than a single verdict.
export async function DELETE(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body?.ids) ? body.ids.filter((v) => typeof v === "string" && v) : [];
    if (!ids.length) {
      return NextResponse.json({ error: "ids[] required" }, { status: 400 });
    }

    // Read the connections ONCE rather than per id: the binding check is the
    // same question for every one of them.
    const connections = await getProviderConnections();
    const usageMap = buildUsageMap(connections);

    const results = [];
    for (const id of ids) {
      const boundConnectionCount = usageMap.get(id) || 0;
      if (boundConnectionCount > 0) {
        results.push({ id, deleted: false, error: "Proxy pool is currently in use", boundConnectionCount });
        continue;
      }
      try {
        await deleteProxyPool(id);
        results.push({ id, deleted: true });
      } catch (error) {
        results.push({ id, deleted: false, error: String(error?.message || error) });
      }
    }

    const deleted = results.filter((r) => r.deleted).length;
    return NextResponse.json({ success: deleted === results.length, deleted, results });
  } catch (error) {
    console.log("Error deleting proxy pools:", error);
    return NextResponse.json({ error: "Failed to delete proxy pools" }, { status: 500 });
  }
}
