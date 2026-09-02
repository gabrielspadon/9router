import { hasValidCliToken } from "@/dashboardGuard";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { getSettings } from "@/lib/localDb";
import { hasTrustedPeerHeaders } from "@/lib/auth/trustedPeer";

export const ANTIGRAVITY_VERIFICATION_ROUTE_POLICY = [
  {
    method: "GET",
    path: "/api/providers/antigravity/verification/stream",
    classification: "sensitive-verification",
  },
  {
    method: "GET",
    path: "/api/providers/antigravity/verification/[connectionId]",
    classification: "sensitive-verification",
  },
  {
    method: "DELETE",
    path: "/api/providers/antigravity/verification/[connectionId]",
    classification: "sensitive-verification",
  },
  {
    method: "POST",
    path: "/api/providers/antigravity/verification/[connectionId]/recheck",
    classification: "sensitive-verification",
  },
];

const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function isExactStampedLoopback(realIp) {
  return realIp === "127.0.0.1" || realIp === "::1" || realIp === "::ffff:127.0.0.1";
}

function unauthorizedResponse() {
  return antigravityVerificationJson({ error: "Unauthorized" }, { status: 401 });
}

function forbiddenResponse() {
  return antigravityVerificationJson({ error: "Forbidden" }, { status: 403 });
}

export function withAntigravityVerificationHeaders(headers = {}) {
  return new Headers({ ...SECURITY_HEADERS, ...Object.fromEntries(new Headers(headers)) });
}

export function antigravityVerificationJson(body, { status = 200, headers = {} } = {}) {
  const responseHeaders = withAntigravityVerificationHeaders(headers);
  if (!responseHeaders.has("content-type")) {
    responseHeaders.set("content-type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

export async function authorizeAntigravityVerification(request) {
  const settings = await getSettings();
  const jwt = await verifyDashboardAuthToken(request.cookies?.get?.("auth_token")?.value);
  const cli = await hasValidCliToken(request);
  const trustedDirectLoopback =
    hasTrustedPeerHeaders(request) &&
    !request.headers.has("x-tp-via-proxy") &&
    isExactStampedLoopback(request.headers.get("x-tp-real-ip"));
  const allowLocalNoLogin = settings?.requireLogin === false && trustedDirectLoopback;

  if (jwt || cli || allowLocalNoLogin) return { ok: true, viaCli: cli };
  return { ok: false, response: unauthorizedResponse() };
}

export async function authorizeAntigravityVerificationMutation(request) {
  const authorization = await authorizeAntigravityVerification(request);
  if (!authorization.ok || authorization.viaCli) return authorization;

  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin || request.headers.get("sec-fetch-site") !== "same-origin") {
    return { ok: false, response: forbiddenResponse() };
  }

  let origin;
  try {
    origin = new URL(rawOrigin);
  } catch {
    return { ok: false, response: forbiddenResponse() };
  }

  if (
    rawOrigin !== new URL(request.url).origin ||
    origin.origin !== rawOrigin ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  ) {
    return { ok: false, response: forbiddenResponse() };
  }

  return authorization;
}
