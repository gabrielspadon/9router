/**
 * Cursor live model catalog fetcher.
 *
 * Cursor exposes the account-specific model picker through the AgentService
 * `GetUsableModels` Connect RPC. Unlike the static provider registry, this
 * includes models newly enabled for the account and omits unavailable ones.
 */

import crypto from "crypto";
import { PROVIDER_OAUTH } from "../providers/index.js";
import { buildCursorHeaders } from "../utils/cursorChecksum.js";
import { decodeMessage } from "../utils/cursorProtobuf.js";
import { connectHttp2 } from "../utils/http2Connect.js";
import { resolveEffectiveProxyRoute } from "../utils/proxyFetch.js";

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

// agent.v1.ModelDetails protobuf field numbers.
const MODEL_ID_FIELD = 1;
const DISPLAY_MODEL_ID_FIELD = 3;
const DISPLAY_NAME_FIELD = 4;
const DISPLAY_NAME_SHORT_FIELD = 5;
const RESPONSE_MODELS_FIELD = 1;

/** @type {Map<string, { expiresAt: number, models: { id: string, name: string }[] }>} */
const catalogCache = new Map();

function getCursorModelsUrl() {
  const config = PROVIDER_OAUTH.cursor;
  if (!config?.agentEndpoint || !config?.modelsEndpoint) return null;
  return `${config.agentEndpoint.replace(/\/$/, "")}${config.modelsEndpoint}`;
}

function cacheKey(credentials, routeCacheIdentity) {
  const seed = [
    credentials?.providerSpecificData?.machineId,
    credentials?.accessToken,
    routeCacheIdentity,
  ].filter(Boolean).join(":");
  if (!seed) return "cursor-anonymous";
  return crypto.createHash("sha256").update(`cursor:${seed}`).digest("hex");
}

function firstString(fields, fieldNumber) {
  const value = fields.get(fieldNumber)?.[0]?.value;
  if (!value || typeof value === "number") return "";
  return Buffer.from(value).toString("utf8");
}

/**
 * Decode Cursor's `agent.v1.GetUsableModelsResponse` protobuf payload.
 * The response contains repeated `agent.v1.ModelDetails` messages in field 1.
 */
export function parseCursorUsableModels(payload) {
  const response = decodeMessage(payload);
  const seen = new Set();
  const models = [];

  for (const entry of response.get(RESPONSE_MODELS_FIELD) || []) {
    if (!entry?.value || typeof entry.value === "number") continue;
    const detail = decodeMessage(entry.value);
    const id = firstString(detail, MODEL_ID_FIELD).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const name = (
      firstString(detail, DISPLAY_NAME_FIELD)
      || firstString(detail, DISPLAY_NAME_SHORT_FIELD)
      || firstString(detail, DISPLAY_MODEL_ID_FIELD)
      || id
    ).trim();
    models.push({ id, name });
  }

  return models;
}

/**
 * agent.api5.cursor.sh is HTTP/2-only; Node fetch/undici cannot speak h2.
 * Unary GetUsableModels uses an unframed protobuf body (application/proto).
 */
function getAbortReason(signal) {
  return signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function http2PostProto(session, headers, body, { signal, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let responseHeaders = {};
    let settled = false;
    let request = null;

    const finish = (fn) => (...args) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      session.removeListener?.("error", onSessionError);
      signal?.removeEventListener("abort", onAbort);
      fn(...args);
    };

    const timeoutId = setTimeout(finish(() => {
      reject(new Error("Cursor GetUsableModels timed out"));
    }), timeoutMs);

    const onAbort = finish(() => {
      const reason = getAbortReason(signal);
      try { request?.destroy(reason); } catch {}
      reject(reason);
    });
    const onSessionError = finish(reject);
    if (signal?.aborted) {
      onAbort();
      return;
    }

    try {
      request = session.request(headers);
    } catch (error) {
      finish(reject)(error);
      return;
    }

    request.on("response", (hdrs) => { responseHeaders = hdrs; });
    request.on("data", (chunk) => { chunks.push(chunk); });
    request.on("end", finish(() => {
      resolve({
        status: Number(responseHeaders[":status"] || 0),
        body: Buffer.concat(chunks),
      });
    }));
    request.on("error", finish(reject));

    session.once?.("error", onSessionError);
    signal?.addEventListener("abort", onAbort, { once: true });

    request.end(body && body.length ? Buffer.from(body) : undefined);
  });
}

function buildCatalogHeaders(credentials, url) {
  const urlObj = new URL(url);
  const accessToken = credentials?.accessToken;
  const machineId = credentials?.providerSpecificData?.machineId;
  const headers = {
    ...buildCursorHeaders(accessToken, machineId, credentials?.providerSpecificData?.ghostMode !== false),
    // Connect unary calls use an unframed protobuf body, unlike Cursor chat's
    // streaming `application/connect+proto` endpoint.
    accept: "application/proto",
    "content-type": "application/proto",
    ":method": "POST",
    ":path": `${urlObj.pathname}${urlObj.search}`,
    ":authority": urlObj.host,
    ":scheme": urlObj.protocol.slice(0, -1),
  };
  delete headers["connect-accept-encoding"];
  delete headers["connect-protocol-version"];
  return headers;
}

/**
 * Resolve the live Cursor catalog for the authenticated account.
 * Returns null on any failure so callers can fall back to static models.
 */
export async function resolveCursorModels(credentials, options = {}) {
  if (!credentials?.accessToken || !credentials?.providerSpecificData?.machineId) {
    options.log?.debug?.("CURSOR_MODELS", "No Cursor access token or machine ID; skipping live fetch");
    return null;
  }

  const url = getCursorModelsUrl();
  if (!url) return null;
  const route = resolveEffectiveProxyRoute(url, options.proxyOptions || { resolutionKind: "unselected" });
  if (route.kind === "relay" || route.kind === "required-unavailable") {
    return { unavailable: true, reason: route.reason || route.kind };
  }

  const cacheReadable = options.forceRefresh !== true;
  const now = Date.now();
  if (cacheReadable && (route.kind === "direct" || route.strictProxy)) {
    const cached = catalogCache.get(cacheKey(credentials, route.cacheIdentity));
    if (cached?.expiresAt > now) return { models: cached.models };
  }

  let lease;
  try {
    const connector = options.connectHttp2 || connectHttp2;
    const post = options.http2Post || http2PostProto;
    lease = await connector(url, { route, signal: options.signal });
    const effectiveRoute = lease?.effectiveRoute;
    if (!effectiveRoute?.cacheIdentity) throw new Error("Cursor HTTP/2 connection returned no effective route");

    const key = cacheKey(credentials, effectiveRoute.cacheIdentity);
    if (cacheReadable) {
      const cached = catalogCache.get(key);
      if (cached?.expiresAt > now) return { models: cached.models };
    }

    const response = await post(
      lease.session,
      buildCatalogHeaders(credentials, url),
      new Uint8Array(),
      { signal: options.signal, timeoutMs: FETCH_TIMEOUT_MS },
    );
    if (response.status !== 200) {
      const error = new Error(`Cursor GetUsableModels returned ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const models = parseCursorUsableModels(new Uint8Array(response.body));
    if (!models?.length) return null;
    catalogCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, models });
    return { models };
  } catch (error) {
    options.log?.warn?.("CURSOR_MODELS", `Live model fetch failed: ${error?.message || error}`);
    return null;
  } finally {
    lease?.close?.();
  }
}

export function clearCursorModelCache() {
  catalogCache.clear();
}
