import {
  clearAccountError,
  extractApiKey,
  getProviderCredentials,
  isValidApiKey,
  markAccountUnavailable,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { getJsonProxyConfig, handleJsonProxyCore } from "open-sse/handlers/jsonProxyCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { checkAndRefreshToken } from "../services/tokenRefresh.js";
import * as log from "../utils/logger.js";

const ENDPOINTS = {
  ocr: { label: "OCR", requiredField: "document" },
  moderation: { label: "MODERATIONS", requiredField: "input" },
};

function validatePayload(body, kind, endpoint) {
  if (!(endpoint.requiredField in body)) return `Missing required field: ${endpoint.requiredField}`;
  if (kind === "ocr" && (!body.document || typeof body.document !== "object" || Array.isArray(body.document))) {
    return "document must be an object";
  }
  if (kind === "moderation" && (
    (typeof body.input !== "string" && !Array.isArray(body.input)) ||
    (Array.isArray(body.input) && body.input.some((item) => typeof item !== "string"))
  )) {
    return "input must be a string or array of strings";
  }
  return null;
}

export async function handleJsonProxy(request, kind) {
  const endpoint = ENDPOINTS[kind];
  if (!endpoint) return errorResponse(HTTP_STATUS.NOT_FOUND, "Unknown endpoint");

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "JSON body must be an object");
  }

  const modelStr = body.model;
  log.request("POST", `${new URL(request.url).pathname} | ${modelStr || "default"}`);
  const apiKey = extractApiKey(request);
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    if (!await isValidApiKey(apiKey)) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }
  if (!modelStr || typeof modelStr !== "string") return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  const payloadError = validatePayload(body, kind, endpoint);
  if (payloadError) return errorResponse(HTTP_STATUS.BAD_REQUEST, payloadError);

  const { provider, model } = await getModelInfo(modelStr);
  if (!provider || !model) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  if (!getJsonProxyConfig(provider, kind)) {
    const capability = endpoint.label === "OCR" ? "OCR" : "moderation";
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support ${capability}`);
  }

  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const message = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model}] ${message}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    const result = await handleJsonProxyCore({
      provider,
      model,
      kind,
      body,
      credentials: await checkAndRefreshToken(provider, credentials),
      signal: request.signal,
    });
    if (result.success) {
      await clearAccountError(credentials.connectionId, credentials, model);
      return result.response;
    }
    if (result.clientAborted) return result.response;

    const { shouldFallback } = await markAccountUnavailable(
      credentials.connectionId, result.status, result.error, provider, model
    );
    if (!shouldFallback) return result.response;
    excludeConnectionIds.add(credentials.connectionId);
    lastError = result.error;
    lastStatus = result.status;
  }
}
