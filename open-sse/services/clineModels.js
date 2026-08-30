import { proxyAwareFetch } from "../utils/proxyFetch.js";

export const CLINE_RECOMMENDED_MODELS_ENDPOINT =
  "https://api.cline.bot/api/v1/ai/cline/recommended-models";

const FETCH_TIMEOUT_MS = 5000;

export function normalizeClineModels(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];

  const seen = new Set();
  const models = [];
  for (const tier of [payload.recommended, payload.free]) {
    if (!Array.isArray(tier)) continue;
    for (const item of tier) {
      const id = typeof item?.id === "string" ? item.id.trim() : "";
      if (!id || id.startsWith("cline-pass/") || seen.has(id)) continue;

      const rawName = typeof item?.name === "string" ? item.name.trim() : "";
      seen.add(id);
      models.push({ id, name: rawName || id });
    }
  }
  return models;
}

export async function resolveClineModels(options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("Cline models fetch timeout")),
    FETCH_TIMEOUT_MS,
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  try {
    const response = await proxyAwareFetch(
      CLINE_RECOMMENDED_MODELS_ENDPOINT,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal,
      },
      options.proxyOptions || null,
    );
    if (!response.ok) return null;

    const models = normalizeClineModels(await response.json());
    return models.length ? { models } : null;
  } catch (error) {
    options.log?.warn?.("CLINE_MODELS", error?.message || error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
