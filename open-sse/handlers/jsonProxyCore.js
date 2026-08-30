import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { PROVIDER_MEDIA } from "../providers/index.js";
import { createErrorResult } from "../utils/error.js";

const KIND_CONFIG_KEYS = {
  ocr: "ocrConfig",
  moderation: "moderationConfig",
};

export function getJsonProxyConfig(provider, kind) {
  const configKey = KIND_CONFIG_KEYS[kind];
  return configKey ? PROVIDER_MEDIA[provider]?.[configKey] || null : null;
}

function buildAuthHeaders(config, credentials) {
  const token = credentials?.apiKey || credentials?.accessToken;
  if (!token || config.authType === "none") return {};
  switch (config.authHeader) {
    case "x-api-key": return { "x-api-key": token };
    case "authorization": return { Authorization: token };
    case "token": return { Authorization: `Token ${token}` };
    default: return { Authorization: `Bearer ${token}` };
  }
}

function sanitizeSecrets(text, credentials) {
  let safe = String(text || "").replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]");
  for (const key of ["apiKey", "accessToken", "refreshToken"]) {
    const secret = credentials?.[key];
    if (typeof secret === "string" && secret.length >= 8) safe = safe.split(secret).join("[redacted]");
  }
  return safe;
}

/**
 * Proxy a JSON-only provider endpoint whose request and response schemas are
 * already native to the client. The application-side handler owns auth,
 * connection selection, and fallback. This core owns the registered endpoint.
 */
export async function handleJsonProxyCore({ provider, model, kind, body, credentials, signal }) {
  const config = getJsonProxyConfig(provider, kind);
  const label = kind === "ocr" ? "OCR" : "moderation";
  if (!config?.baseUrl) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support ${label}`);
  }

  let upstream;
  try {
    upstream = await fetch(config.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.headers || {}),
        ...buildAuthHeaders(config, credentials),
      },
      body: JSON.stringify({ ...body, model }),
      signal,
    });
  } catch (error) {
    const message = sanitizeSecrets(error?.message || "Upstream request failed", credentials);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `[${provider}] ${label} upstream fetch failed: ${message}`);
  }

  const responseBody = await upstream.text().catch(() => "");
  if (!upstream.ok) {
    const message = sanitizeSecrets(responseBody || `HTTP ${upstream.status}`, credentials);
    return createErrorResult(upstream.status, `[${provider}] ${message.slice(0, 2000)}`);
  }

  return {
    success: true,
    response: new Response(responseBody, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}
