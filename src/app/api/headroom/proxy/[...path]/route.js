import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";

export const dynamic = "force-dynamic";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export const DASHBOARD_PREFIX = "/api/headroom/proxy";

const ALLOWED_PREFIXES = [
  "dashboard",
  "assets",
  "_next",
  "static",
  "favicon",
  "stats",
  "stats-history",
  // The Headroom dashboard's lifetime view reads the durable savings history
  // from `/stats-lifetime`, and its settings page reads `/settings`,
  // `/settings/schema` and `/settings/apply`. Neither name matches the `stats`
  // or `dashboard` entries above (the match is exact, `/p/` or `/p.`), so both
  // were left unrewritten and fetched from the tokenproxy origin instead of the
  // proxy — a 404 the dashboard surfaces as an error status with no data
  // (#2330). This list only decides which links in Headroom's own HTML get the
  // proxy prefix; the route already forwards every path under it, so naming
  // them here widens nothing.
  "stats-lifetime",
  "settings",
  "health",
  "livez",
  "readyz",
  "metrics",
  "transformations",
];

function isAllowedPath(url, prefix) {
  if (url === prefix || url.startsWith(prefix + "/")) return false;
  if (url.startsWith("//")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return false;
  if (!url.startsWith("/")) return false;
  const pathOnly = url.split("?")[0].split("#")[0];
  for (const p of ALLOWED_PREFIXES) {
    if (pathOnly === `/${p}`) return true;
    if (pathOnly.startsWith(`/${p}/`)) return true;
    if (pathOnly.startsWith(`/${p}.`)) return true;
  }
  return false;
}

export function rewriteHeadroomHtml(html, prefixOverride) {
  if (typeof html !== "string") return html;
  if (!html) return html;
  const prefix = prefixOverride || DASHBOARD_PREFIX;

  let out = html.replace(
    /\b(src|href|action)\s*=\s*(["'])(\/[^"']*)\2/g,
    (match, attr, quote, url) => {
      if (!isAllowedPath(url, prefix)) return match;
      return `${attr}=${quote}${prefix}${url}${quote}`;
    },
  );

  out = out.replace(
    /fetch\s*\(\s*(['"`])(\/[^'"`]*?)\1/g,
    (match, quote, url) => {
      if (url.includes("\\") || url.includes("${")) return match;
      if (!isAllowedPath(url, prefix)) return match;
      return `fetch(${quote}${prefix}${url}${quote}`;
    },
  );

  return out;
}

export function rewriteLocation(value, target) {
  if (value == null) return value;
  if (value === "") return "";
  if (typeof value !== "string") return value;
  if (value === DASHBOARD_PREFIX || value.startsWith(DASHBOARD_PREFIX + "/"))
    return value;
  if (value.startsWith("//")) return value;

  const schemeRe = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
  if (schemeRe.test(value)) {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) return value;
      const targetUrl = target instanceof URL ? target : new URL(target);
      if (url.origin !== targetUrl.origin) return value;
      const path = url.pathname + url.search + url.hash;
      return `${DASHBOARD_PREFIX}${path}`;
    } catch {
      return value;
    }
  }

  try {
    const targetUrl = target instanceof URL ? target : new URL(target);
    const resolved = new URL(value, targetUrl);
    if (resolved.origin !== targetUrl.origin) return value;
    const path = resolved.pathname + resolved.search + resolved.hash;
    return `${DASHBOARD_PREFIX}${path}`;
  } catch {
    return value;
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLoopbackTarget(target) {
  return LOOPBACK_HOSTS.has(
    (target?.hostname || "").replace(/^\[|\]$/g, "").toLowerCase(),
  );
}

export function forwardedHeaders(request, target) {
  const headers = new Headers(request.headers);
  for (const key of [...headers.keys()]) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) headers.delete(key);
  }
  headers.delete("host");
  headers.delete("proxy-authorization");
  headers.delete("proxy-authenticate");
  // Never leak viewer credentials to a non-loopback Headroom host. For
  // loopback targets the viewer's own credentials are forwarded so the local
  // Headroom keeps its auth behavior; HEADROOM_API_KEY covers the rest.
  if (!isLoopbackTarget(target)) {
    headers.delete("cookie");
    headers.delete("authorization");
  }
  const raw = process.env.HEADROOM_API_KEY;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed) headers.set("authorization", `Bearer ${trimmed}`);
  }
  return headers;
}

async function getTargetBase() {
  const settings = await getSettings();
  const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("Headroom URL must use http or https");
  }
  return target;
}

function buildTargetUrl(base, path, search) {
  const target = new URL(base);
  const basePath = target.pathname.replace(/\/$/, "");
  const incoming = path.join("/");
  if (incoming) {
    target.pathname = `${basePath}/${incoming}`;
  } else {
    target.pathname = basePath || "/";
  }
  target.search = search;
  return target;
}

async function proxy(request, { params }) {
  try {
    const base = await getTargetBase();
    const { search } = new URL(request.url);
    const path = (await params).path || [];
    const target = buildTargetUrl(base, path, search);
    const method = request.method;
    const hasBody = !["GET", "HEAD"].includes(method);

    const response = await fetch(target, {
      method,
      headers: forwardedHeaders(request, target),
      body: hasBody ? request.body : undefined,
      duplex: hasBody ? "half" : undefined,
      redirect: "manual",
    });

    const headers = new Headers(response.headers);
    for (const key of [...headers.keys()]) {
      if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) headers.delete(key);
    }

    const loc = headers.get("location");
    if (loc) {
      const rewritten = rewriteLocation(loc, base);
      if (rewritten !== loc) headers.set("location", rewritten);
    }

    const contentType = response.headers.get("content-type") || "";
    const isHtml = contentType.includes("text/html");

    if (isHtml) {
      const body = await response.text();
      const rewritten = rewriteHeadroomHtml(body);
      if (rewritten !== body) headers.delete("content-length");
      return new NextResponse(rewritten, { status: response.status, headers });
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers,
    });
  } catch {
    return NextResponse.json(
      { error: "Headroom proxy request failed" },
      { status: 502 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
