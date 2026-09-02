import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import { hasValidCliToken, isLocalRequest } from "@/dashboardGuard";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

export const dynamic = "force-dynamic";

/**
 * POST /api/oauth/codex/export  — body { connectionId }
 *
 * Emits ONE Codex account in the shape /api/oauth/codex/bulk-import already
 * consumes, so an export re-imports on another install without a second parser
 * and without inventing a file format (#1590). The import half of that issue is
 * already served: bulk-import accepts a bare single object as well as an array.
 *
 * This response contains an OAuth refresh token, which is the same class of
 * egress /api/settings/database is kept in ALWAYS_PROTECTED for. It is therefore
 * gated exactly like the LOCAL_ONLY_PATHS entries in src/dashboardGuard.js — the
 * caller is on the loopback socket or holds the machine-bound CLI token — AND
 * like ALWAYS_PROTECTED, requiring a real signed-in session rather than merely an
 * open dashboard, because requireLogin=false must not turn a tunnelled dashboard
 * into a credential download. The gate lives in the route so it travels with it.
 *
 * POST rather than GET: a credential response must not be reachable by a bare
 * cross-site navigation, and a JSON body is not a form a third-party page can
 * submit. Nothing here is logged and no token ever enters a URL or a message.
 */
async function isAuthorized(request) {
  if (await hasValidCliToken(request)) return true;
  if (!isLocalRequest(request)) return false;
  const jwt = request.cookies?.get?.("auth_token")?.value;
  return Boolean(jwt && (await verifyDashboardAuthToken(jwt)));
}

// Proxy policy is per-install: a pool id from the source machine names nothing on
// the destination, so it is left behind rather than exported as a dangling id.
const PROXY_BOUND_KEYS = [
  "proxyPoolId", "strictProxy", "connectionProxyMode",
  "connectionProxyEnabled", "connectionProxyUrl", "connectionNoProxy",
];

const EXPORTED_FIELDS = [
  "accessToken", "refreshToken", "idToken",
  "expiresAt", "expiresIn", "tokenType", "scope", "lastRefreshAt",
];

export async function POST(request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json(
      { error: "Local only: this export returns account credentials, so it needs a signed-in session on this machine or the CLI token" },
      { status: 403 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid or empty request body" }, { status: 400 });
  }

  const connectionId = typeof body?.connectionId === "string" ? body.connectionId.trim() : "";
  if (!connectionId) {
    return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
  }

  const connection = await getProviderConnectionById(connectionId);
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (connection.provider !== "codex") {
    return NextResponse.json({ error: "Connection is not a Codex account" }, { status: 400 });
  }

  // `provider` lets /api/providers/[id]/reauth refuse a codex file dropped on a
  // non-codex account; bulk-import strips it, so the round trip is unaffected.
  const account = { provider: "codex", authType: connection.authType || "oauth" };
  if (connection.email) account.email = connection.email;
  if (connection.name) account.name = connection.name;
  for (const f of EXPORTED_FIELDS) {
    if (connection[f] !== undefined && connection[f] !== null) account[f] = connection[f];
  }

  const psd = connection.providerSpecificData;
  if (psd && typeof psd === "object" && !Array.isArray(psd)) {
    const carried = { ...psd };
    for (const key of PROXY_BOUND_KEYS) delete carried[key];
    if (Object.keys(carried).length) account.providerSpecificData = carried;
  }

  if (!account.accessToken && !account.refreshToken) {
    return NextResponse.json(
      { error: "This account holds no credential to export" },
      { status: 409 }
    );
  }

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts: [account],
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // The body is a credential: never cached, never stored by an intermediary,
      // and never offered to a referrer.
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="codex-account.json"`,
    },
  });
}
