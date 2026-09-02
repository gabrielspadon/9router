import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { AI_PROVIDERS } from "@/shared/constants/providers";

/**
 * POST /api/providers/import
 *
 * Import provider connections from pasted JSON (#1329).
 *
 * Per-provider importers already exist (codex bulk-import, cursor import, kiro
 * cli-proxy, gitlab pat) but each is wired to one provider, so moving a set of
 * accounts between machines meant knowing which route each account needed. This
 * is the provider-agnostic one: the provider comes from the item.
 *
 * Body accepts any of:
 *   - Array:              [{...}, {...}]
 *   - Single:             {...}
 *   - Wrapped:            { accounts: [...] }
 *   - Database export:    { providerConnections: [...] }
 *
 * A wrapped body may carry `provider` and `authType` beside the list, which
 * every item inherits unless it names its own (#1611). That is what makes a
 * pasted token list importable: the Antigravity report is a bare
 * `{"refresh_token": "1//0g..."}` or an array of them, which names no provider
 * and no auth type because the person pasting it already picked both. Snake
 * case is folded to the connection layer's spelling for the same reason.
 *
 * AUTH. Nothing here authenticates. `/api/providers/import` is deliberately
 * absent from the public path lists in src/dashboardGuard.js, so it falls to
 * the deny-by-default branch for `/api/*` and an unauthenticated request is
 * refused 401 before this handler runs. That matters more here than elsewhere:
 * the body is credentials.
 *
 * Tokens are NEVER echoed back in the response.
 */

// The four the connection layer actually branches on. Anything else is a typo
// or a hostile field, and coercing it to a default would create a row whose
// credentials are never used the way the exporter meant.
const AUTH_TYPES = new Set(["oauth", "access_token", "apikey", "cookie"]);

// Written straight through. Everything else in an item is dropped, so an export
// carrying extra columns from a newer schema imports rather than failing, and a
// crafted body cannot reach a field the connection layer owns.
const IMPORTABLE_FIELDS = [
  "name", "displayName", "email", "apiKey", "accessToken", "refreshToken",
  "idToken", "expiresAt", "expiresIn", "defaultModel", "priority",
  "globalPriority", "isActive", "testStatus", "lastRefreshAt",
  "providerSpecificData",
];

// Snake case is what a hand-pasted token and most third-party exports carry;
// the connection layer branches on exactly one spelling per field. Fold once
// here so no caller has to know both (#1611). A camelCase key already present
// wins, since it is the spelling this server itself writes.
const FIELD_ALIASES = {
  auth_type: "authType",
  display_name: "displayName",
  api_key: "apiKey",
  access_token: "accessToken",
  refresh_token: "refreshToken",
  id_token: "idToken",
  expires_at: "expiresAt",
  expires_in: "expiresIn",
  default_model: "defaultModel",
  global_priority: "globalPriority",
  is_active: "isActive",
  test_status: "testStatus",
  last_refresh_at: "lastRefreshAt",
  provider_specific_data: "providerSpecificData",
};

function foldAliases(raw) {
  const folded = { ...raw };
  for (const [snake, camel] of Object.entries(FIELD_ALIASES)) {
    if (folded[snake] !== undefined && folded[camel] === undefined) folded[camel] = folded[snake];
  }
  return folded;
}

// Which credential is present fully determines which branch the connection
// layer takes, so an item that names no authType has no ambiguity to resolve
// and is inferred rather than refused (#1611). A refresh token is the one that
// gets renewed, so it decides even when an access token sits beside it.
function inferAuthType(item) {
  if (item.refreshToken) return "oauth";
  if (item.apiKey) return "apikey";
  if (item.accessToken) return "access_token";
  return undefined;
}

function collect(body) {
  if (Array.isArray(body)) return { items: body, defaults: {} };
  if (!body || typeof body !== "object") return { items: null, defaults: {} };
  const defaults = { provider: body.provider, authType: body.authType };
  if (Array.isArray(body.accounts)) return { items: body.accounts, defaults };
  if (Array.isArray(body.providerConnections)) return { items: body.providerConnections, defaults };
  // A single object IS the item; its own provider field is read below, so it
  // must not also act as its own default.
  return { items: [body], defaults: {} };
}

export function normalizeImportItem(rawItem, defaults = {}) {
  if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
    throw new Error("Item is not an object");
  }
  const raw = foldAliases(rawItem);

  const declaredProvider = raw.provider ?? defaults.provider;
  const provider = normalizeProviderId(declaredProvider);
  if (!provider || !AI_PROVIDERS[provider]) {
    throw new Error(`Unknown provider: ${declaredProvider ?? "(missing)"}`);
  }

  // A row with no credential at all is the one failure the importer must not
  // pass on: it creates an account that looks present and fails every request.
  // Checked before authType so a body missing both is told the useful half.
  if (!raw.apiKey && !raw.accessToken && !raw.refreshToken) {
    throw new Error("No credential (apiKey, accessToken or refreshToken)");
  }

  // "api_key" is the spelling some exports carry; the connection layer stores
  // "apikey" and branches on it.
  const declaredAuthType = raw.authType ?? defaults.authType;
  const authType = declaredAuthType === "api_key"
    ? "apikey"
    : (declaredAuthType ?? inferAuthType(raw));
  if (!AUTH_TYPES.has(authType)) {
    throw new Error(`Unknown authType: ${declaredAuthType ?? "(missing)"}`);
  }

  const item = { provider, authType };
  for (const field of IMPORTABLE_FIELDS) {
    if (raw[field] !== undefined) item[field] = raw[field];
  }
  if (item.providerSpecificData && typeof item.providerSpecificData !== "object") {
    throw new Error("providerSpecificData is not an object");
  }

  // Same defaults the OAuth-completed flow leaves behind, so an imported row
  // behaves like one the login flow made.
  if (!item.expiresAt && typeof item.expiresIn === "number" && item.expiresIn > 0) {
    item.expiresAt = new Date(Date.now() + item.expiresIn * 1000).toISOString();
  }
  if (item.testStatus === undefined) item.testStatus = "active";
  if (item.isActive === undefined) item.isActive = true;

  return item;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ error: `Invalid JSON body: ${err.message}` }, { status: 400 });
  }

  const { items, defaults } = collect(body);
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "No accounts provided" }, { status: 400 });
  }

  const results = [];
  let success = 0;
  let failed = 0;

  // SERIAL — createProviderConnection reads max(priority) and reorders inside a
  // transaction, so parallel calls race on priority assignment.
  for (let i = 0; i < items.length; i++) {
    try {
      const created = await createProviderConnection(normalizeImportItem(items[i], defaults));
      results.push({ index: i, ok: true, id: created.id, provider: created.provider });
      success++;
    } catch (e) {
      results.push({ index: i, ok: false, error: e.message || "Unknown error" });
      failed++;
    }
  }

  return NextResponse.json({ success, failed, results });
}
