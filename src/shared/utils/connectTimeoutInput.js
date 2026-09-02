import {
  CONNECT_TIMEOUT_DEFAULT_MS,
  isValidConnectTimeoutMs,
} from "../../../open-sse/config/connectTimeout.js";
import { assertProviderStrategyPatchConfirmation } from "./providerStrategyPatch.js";

export function parseConnectTimeoutDraft(draft, { provider = false } = {}) {
  const text = String(draft ?? "").trim();
  if (text === "") {
    return provider
      ? { ok: true, value: null, canonical: "" }
      : {
          ok: true,
          value: CONNECT_TIMEOUT_DEFAULT_MS,
          canonical: String(CONNECT_TIMEOUT_DEFAULT_MS),
        };
  }
  if (!/^\d+$/.test(text)) {
    return { ok: false, error: "Enter a whole number from 1000 through 120000" };
  }
  const value = Number(text);
  if (!isValidConnectTimeoutMs(value)) {
    return { ok: false, error: "Enter a whole number from 1000 through 120000" };
  }
  return { ok: true, value, canonical: String(value) };
}

export function buildConnectTimeoutPayload({ providerId, value }) {
  if (!providerId) return { connectTimeoutMs: value };
  return { providerStrategyPatch: { providerId, values: { connectTimeoutMs: value } } };
}

export function extractConfirmedConnectTimeout(settings, providerId) {
  if (!providerId) return settings?.connectTimeoutMs;
  return settings?.providerStrategies?.[providerId]?.connectTimeoutMs ?? null;
}

export async function saveConnectTimeout({ fetchImpl = fetch, providerId, value }) {
  const response = await fetchImpl("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildConnectTimeoutPayload({ providerId, value })),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Failed to save connect timeout");
  if (providerId) {
    assertProviderStrategyPatchConfirmation(
      data,
      providerId,
      { connectTimeoutMs: value },
      "Settings API did not confirm the requested connect timeout",
    );
  }
  const confirmed = extractConfirmedConnectTimeout(data, providerId);
  if (confirmed !== value) {
    throw new Error("Settings API did not confirm the requested connect timeout");
  }
  if (confirmed !== null && !isValidConnectTimeoutMs(confirmed)) {
    throw new Error("Settings API returned an invalid connect timeout");
  }
  return { confirmed, settings: data };
}
