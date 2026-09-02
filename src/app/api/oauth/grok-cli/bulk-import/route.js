import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { decodeXaiIdTokenEmail, extractEmailFromAccessToken } from "@/lib/oauth/providerHelpers";

/**
 * POST /api/oauth/grok-cli/bulk-import
 * Bulk import multiple Grok CLI (OAuth device-code) account JSON objects in one call.
 *
 * Body accepts any of:
 *   - Array:    [{...}, {...}]
 *   - Single:   {...}
 *   - Wrapped:  { accounts: [{...}, ...] }
 *
 * Each item must carry an access token, as `access_token` or `accessToken` —
 * the CLI writes snake_case, the dashboard export writes camelCase. A missing
 * email is best-effort backfilled from the id_token, then from the access token.
 *
 * Tokens are NEVER echoed back in the response.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid JSON body: ${err.message}` },
      { status: 400 }
    );
  }

  // Normalize to array
  let accounts;
  if (Array.isArray(body)) {
    accounts = body;
  } else if (body && typeof body === "object" && Array.isArray(body.accounts)) {
    accounts = body.accounts;
  } else if (body && typeof body === "object") {
    accounts = [body];
  } else {
    accounts = null;
  }

  if (!Array.isArray(accounts) || accounts.length === 0) {
    return NextResponse.json(
      { error: "No accounts provided" },
      { status: 400 }
    );
  }

  const results = [];
  let success = 0;
  let failed = 0;

  // SERIAL loop — createProviderConnection reads max(priority) and reorders
  // inside a transaction. Parallel calls would race on priority assignment.
  for (let i = 0; i < accounts.length; i++) {
    const raw = accounts[i];
    try {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Item is not an object");
      }

      const accessToken = raw.access_token || raw.accessToken;
      if (!accessToken || typeof accessToken !== "string") {
        throw new Error("Missing access_token / accessToken");
      }
      const refreshToken = raw.refresh_token || raw.refreshToken || null;
      const idToken = raw.id_token || raw.idToken || null;

      const email =
        raw.email ||
        decodeXaiIdTokenEmail(idToken) ||
        extractEmailFromAccessToken(accessToken) ||
        null;

      let expiresAt = raw.expires_at || raw.expiresAt || null;
      const expiresIn = raw.expires_in ?? raw.expiresIn;
      if (!expiresAt && typeof expiresIn === "number" && expiresIn > 0) {
        expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      }

      // Mirrors mapTokens in src/lib/oauth/providers/grok-cli.js — GrokCliExecutor
      // reads identity off providerSpecificData, not off the top-level fields.
      const created = await createProviderConnection({
        provider: "grok-cli",
        authType: "oauth",
        accessToken,
        refreshToken,
        idToken,
        expiresAt,
        email,
        displayName: raw.displayName || raw.name || undefined,
        testStatus: "active",
        isActive: true,
        lastRefreshAt: new Date().toISOString(),
        providerSpecificData: {
          authMethod: "device_code",
          idToken,
          email,
          ...(raw.providerSpecificData || {}),
        },
      });

      results.push({ index: i, ok: true, id: created.id });
      success++;
    } catch (e) {
      results.push({ index: i, ok: false, error: e.message || "Unknown error" });
      failed++;
    }
  }

  return NextResponse.json({ success, failed, results });
}
