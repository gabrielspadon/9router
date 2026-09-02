import { isModelAllowed } from "@/lib/db/repos/apiKeysRepo.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

/**
 * Refuse a request whose API key is not allowed to use the model it asked for
 * (#448, #2833).
 *
 * The per-key model allowlist shipped with #1154, but it was only ever checked
 * in the rerank handler. Every other public modality — chat, embeddings,
 * images, tts, stt, search, fetch, video and the json proxy — read the same
 * key and never consulted it, so a key restricted to cheap models could spend
 * the operator's quota on any model in the router by asking on a different
 * endpoint. Two independent upstream reports found the same hole.
 *
 * It lives here rather than in each handler so a modality added later inherits
 * the check by calling one function, which is how the hole opened in the first
 * place.
 *
 * The string checked is the one the CLIENT sent, before combo expansion. That
 * is the designed semantic: matchesAllowedModel matches a combo name like any
 * other model, so an operator restricts a key to a combo by naming it.
 *
 * @returns {Promise<Response|null>} a 403 to return, or null to continue.
 */
export async function refuseDisallowedModel(apiKey, modelStr, log) {
  if (!apiKey || !modelStr) return null;
  if (await isModelAllowed(apiKey, modelStr)) return null;
  log?.warn?.("AUTH", `Key not allowed to use model: ${modelStr}`);
  return errorResponse(HTTP_STATUS.FORBIDDEN, `Model not allowed for this API key: ${modelStr}`);
}
