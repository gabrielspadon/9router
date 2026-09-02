import { NextResponse } from "next/server";
import { getProviderNodeById } from "@/lib/db/repos/nodesRepo.js";
import { assertPublicUrl, fetchPublicUrl } from "@/shared/utils/ssrfGuard";

/**
 * GET /api/provider-nodes/favicon?nodeId=<id>
 *
 * Server-side favicon discovery for a custom provider node (#1830), so the
 * dashboard can show a provider's own mark instead of initials.
 *
 * WHY THE PARAMETER IS A NODE ID AND NEVER A URL. The report asks for SSRF
 * protection before fetching a user-provided URL. The stronger answer is not to
 * accept one: the only fetchable origins are the base URLs an operator has
 * already registered as provider nodes, which the gateway already sends
 * requests and API keys to. A route taking a raw URL would be a general-purpose
 * fetch proxy sitting behind the dashboard session, and no amount of filtering
 * makes that a good idea. assertPublicUrl still runs on every candidate,
 * because a node's base URL is operator input and may point at loopback.
 *
 * The response is a data URI rather than a redirect or a proxied stream, so the
 * dashboard renders it with no second request and no CORS question. A miss is a
 * 204, which is the caller's signal to use initials — the reliable final
 * fallback the report asks to keep.
 */

export const dynamic = "force-dynamic";

// Both outcomes are cached. A negative result is the one worth caching most: a
// provider with no favicon would otherwise be re-probed on every render, three
// requests at a time, forever.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 30 * 60 * 1000;
const cache = new Map();

// A favicon is small. The cap is what stops a hostile or merely wrong endpoint
// streaming an arbitrary body into the dashboard's memory.
const MAX_BYTES = 128 * 1024;
const FETCH_TIMEOUT_MS = 4000;
const ALLOWED_TYPES = new Set([
  "image/x-icon", "image/vnd.microsoft.icon", "image/png",
  "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
]);

/**
 * Candidates in the order the report asks for: endpoint-adjacent, then the
 * origin root, then the registrable domain. Deduplicated, because for a base
 * URL already at the origin root the first two collapse.
 */
export function faviconCandidates(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return [];
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return [];

  const out = [];
  const push = (candidate) => {
    if (candidate && !out.includes(candidate)) out.push(candidate);
  };

  // Endpoint-adjacent: the directory the base URL points into.
  const dir = url.pathname.endsWith("/") ? url.pathname : `${url.pathname.replace(/\/[^/]*$/, "")}/`;
  if (dir && dir !== "/") push(new URL(`${dir}favicon.ico`, url.origin).href);
  push(`${url.origin}/favicon.ico`);

  // Registrable domain, one label up. Only for a real dotted hostname, never for
  // an IP literal, where "one label up" means nothing.
  const host = url.hostname;
  if (!/^[\d.]+$/.test(host) && !host.includes(":")) {
    const labels = host.split(".");
    if (labels.length > 2) {
      push(`${url.protocol}//${labels.slice(-2).join(".")}/favicon.ico`);
    }
  }
  return out;
}

async function readIcon(candidate) {
  assertPublicUrl(candidate);
  const response = await fetchPublicUrl(candidate, {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return null;

  const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) return null;

  // Trust the declared length when it is over the cap, and re-check the real
  // body after: a missing or lying Content-Length is the normal case.
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) return null;

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_BYTES) return null;

  return `data:${type};base64,${buffer.toString("base64")}`;
}

export async function GET(request) {
  const nodeId = new URL(request.url).searchParams.get("nodeId");
  if (!nodeId) {
    return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
  }

  const node = await getProviderNodeById(nodeId);
  if (!node?.baseUrl) {
    return NextResponse.json({ error: "Provider node not found" }, { status: 404 });
  }

  const cached = cache.get(node.baseUrl);
  if (cached && cached.until > Date.now()) {
    return cached.icon
      ? NextResponse.json({ icon: cached.icon, source: cached.source })
      : new NextResponse(null, { status: 204 });
  }

  for (const candidate of faviconCandidates(node.baseUrl)) {
    let icon = null;
    try {
      icon = await readIcon(candidate);
    } catch {
      // A blocked, unreachable or malformed candidate is a miss, not an error:
      // the next candidate, and ultimately initials, still answer.
      continue;
    }
    if (icon) {
      cache.set(node.baseUrl, { icon, source: candidate, until: Date.now() + CACHE_TTL_MS });
      return NextResponse.json({ icon, source: candidate });
    }
  }

  cache.set(node.baseUrl, { icon: null, source: null, until: Date.now() + NEGATIVE_TTL_MS });
  return new NextResponse(null, { status: 204 });
}
