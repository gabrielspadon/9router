import { NextResponse } from "next/server";
import { reauthorizeProviderConnection } from "@/lib/db/repos/connectionsRepo.js";

/**
 * POST /api/providers/[id]/reauth
 *
 * Re-authenticate an account that already exists (#1851) by handing it a freshly
 * issued credential, for the flows that do not go through
 * /api/oauth/[provider]/[action] — a pasted token, or an auth file exported from
 * another install (#1590). The OAuth and device-code flows carry the same intent
 * as `reauthConnectionId` in the body they already post.
 *
 * The point of the endpoint is what it does NOT touch: the connection keeps its
 * id, its priority (and so its place in the fallback order), its name, its
 * defaultModel and the proxy binding inside providerSpecificData. Only the
 * credential changes. Deleting and re-adding the account, which is what users do
 * today, loses every one of those.
 *
 * Body: { accessToken?, refreshToken?, idToken?, apiKey?, expiresIn?, expiresAt?,
 *         tokenType?, scope?, projectId?, email?, authType?, providerSpecificData?,
 *         force? }  — the shape /api/oauth/codex/export emits.
 *
 * Refuses before it writes when the payload carries no usable credential, so a
 * truncated or malformed file cannot replace a working credential with an empty
 * one. Tokens are never logged and never echoed back.
 */

const CREDENTIAL_KEYS = ["accessToken", "refreshToken", "idToken", "apiKey"];
const CARRIED_KEYS = [
  "expiresAt", "expiresIn", "tokenType", "scope", "projectId",
  "lastRefreshAt", "email", "providerSpecificData",
];

// A file naming an auth type the router does not have would leave the account
// unroutable, so an unrecognised one is dropped and the row keeps the type it has.
const AUTH_TYPES = new Set(["oauth", "apikey", "api_key", "access_token", "cookie", "none"]);

const FAILURE = {
  not_found: [404, "Connection not found"],
  provider_mismatch: [400, "Credential belongs to a different provider"],
  empty_credential: [400, "No usable credential in the payload; the existing one was kept"],
  identity_mismatch: [409, "This credential belongs to a different account than the connection holds; re-send with force to rebind it"],
};

function pickString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request, { params }) {
  const { id } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid or empty request body" }, { status: 400 });
  }
  // A single exported account, or the { accounts: [one] } wrapper the codex
  // export and bulk-import both speak. More than one account has no single
  // target, so it is a request error rather than a silent pick of the first.
  if (Array.isArray(body?.accounts)) {
    if (body.accounts.length !== 1) {
      return NextResponse.json(
        { error: "Re-authentication takes exactly one account" },
        { status: 400 }
      );
    }
    body = body.accounts[0];
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected an account object" }, { status: 400 });
  }

  const patch = {};
  let hasCredential = false;
  for (const key of CREDENTIAL_KEYS) {
    const value = pickString(body[key]);
    if (value) { patch[key] = value; hasCredential = true; }
  }
  // Validated before anything is read from the database: an empty or malformed
  // file must never reach a write path at all.
  if (!hasCredential) {
    return NextResponse.json(
      { error: "No usable credential in the payload; the existing one was kept" },
      { status: 400 }
    );
  }
  for (const key of CARRIED_KEYS) {
    if (body[key] !== undefined && body[key] !== null) patch[key] = body[key];
  }
  if (!patch.expiresAt && typeof patch.expiresIn === "number" && patch.expiresIn > 0) {
    patch.expiresAt = new Date(Date.now() + patch.expiresIn * 1000).toISOString();
  }
  const authType = pickString(body.authType);
  if (authType && AUTH_TYPES.has(authType)) patch.authType = authType;
  // Carried so the repo can refuse a credential dropped on another provider's row.
  const provider = pickString(body.provider);
  if (provider) patch.provider = provider;
  if (body.force === true) patch.force = true;

  const outcome = await reauthorizeProviderConnection(id, patch);
  if (!outcome.ok) {
    const [status, error] = FAILURE[outcome.code] || [400, "Re-authentication failed"];
    return NextResponse.json({ error }, { status });
  }

  const { connection } = outcome;
  return NextResponse.json({
    success: true,
    connection: {
      id: connection.id,
      provider: connection.provider,
      authType: connection.authType,
      name: connection.name,
      email: connection.email,
      priority: connection.priority,
      updatedAt: connection.updatedAt,
    },
  });
}
