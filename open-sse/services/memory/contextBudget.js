/**
 * Context budget — how much of the model's window this request may occupy, and
 * how far over it currently is.
 *
 * WHY THIS EXISTS. Every token saver in the pipeline used to fire on a fixed
 * threshold that knew nothing about the model it was shaping for. The tool
 * pruner was the worst of them: on by default, it kept the last two tool turns
 * at full size and truncated every earlier tool result to 800 characters, on
 * every request, forever. Measured on the RTX seam over six hours that
 * discarded 212 million tokens of conversation history across 5,008 requests —
 * a median of 29,000 tokens per request, 109,000 at the 90th percentile, and
 * 166,000 at the worst — while the model it was shaping for had a one-million
 * token window and the sessions were plateauing around 350,000. The proxy was
 * throwing away two thirds of the context the operator was paying for.
 *
 * It also destroyed the prompt cache every single turn, which costs real money.
 * "The last two tool turns" is counted from the END of the conversation, so the
 * result that was full-size on turn N is truncated on turn N+1. That rewrites
 * the middle of the prefix on every request, and a rewritten prefix is a cache
 * miss for everything after it. A saver that bills a full re-prime of a 300k
 * prefix to save 29k tokens of history is not saving anything.
 *
 * THE POLICY. Spend the window. Prune nothing while the request fits inside the
 * model's window less a reserve. Once it does not fit, prune the least
 * informative thing first and only as far as the overflow requires, oldest
 * first, escalating in tiers. Prune as little as possible and as much as
 * needed, and leave the prefix alone until the ceiling actually forces a
 * change — which for most sessions is never, so the cache survives the whole
 * conversation instead of dying every turn.
 *
 * Pure and now-independent: every input is a parameter, so a budget decision is
 * reproducible from what it was handed.
 */

// Characters per token. Deliberately on the low side for prose, because the
// traffic this shapes is code and JSON, where tokens are shorter than in
// English and a per-character estimate that assumes 4 will undercount.
export const CHARS_PER_TOKEN = 3.8;

// The window to assume when nothing knows better. Matches the engine's own
// DEFAULT_CAPABILITIES so a model this table has never heard of is not
// suddenly treated as though it had a megatoken of room.
export const DEFAULT_CONTEXT_WINDOW = 200_000;

// Headroom held back from the window, as a fraction of it. This is what the
// reply, the client's own compaction pass, and one more tool result have to
// fit inside, so it is never zero and never the whole point of the window.
export const DEFAULT_RESERVE_FRACTION = 0.05;

// Never hold back less than this many tokens, however small the window. A 5%
// reserve on a 16k model is 800 tokens, which one reply overruns.
export const MIN_RESERVE_TOKENS = 8_000;

// When pruning does have to happen, come down to this far BELOW the trigger
// rather than to exactly the trigger. Without it every subsequent turn lands
// one token over the line and re-prunes, which is the moving boundary this
// whole module exists to stop: each re-prune is another cache invalidation.
// With it, one prune buys many turns of a byte-stable prefix.
export const DEFAULT_RELIEF_FRACTION = 0.10;

// A media block's real token cost is roughly its pixel count, not its encoded
// length. A 1 MB base64 screenshot is about 1,600 tokens and about 1,400,000
// characters, so charging it by length overstates it by three orders of
// magnitude — enough on its own to make a request look like it had overrun a
// megatoken window. Charged flat instead, which is wrong by a factor of two at
// worst rather than by a factor of a thousand.
export const MEDIA_TOKEN_ESTIMATE = 1_600;

function isMediaBlock(block) {
  if (!block || typeof block !== 'object') return false;
  const t = block.type;
  return (
    t === 'image_url'
    || t === 'image'
    || t === 'input_image'
    || t === 'input_audio'
    || t === 'audio_url'
    || t === 'audio'
    || t === 'input_video'
    || t === 'video_url'
    || t === 'video'
    || t === 'document'
    || t === 'file'
    || Boolean(block.inlineData?.mimeType)
    || Boolean(block.fileData?.mimeType)
    || Boolean(block.source?.data)
  );
}

/**
 * Characters of text in an arbitrary value, with media charged as its flat
 * token estimate converted back to characters rather than by encoded length.
 */
export function estimateChars(value, depth = 0) {
  if (value === null || value === undefined) return 0;
  if (depth > 12) return 0;
  if (typeof value === 'string') return value.length;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).length;
  if (Array.isArray(value)) {
    let total = 0;
    for (const item of value) total += estimateChars(item, depth + 1);
    return total;
  }
  if (typeof value !== 'object') return 0;
  if (isMediaBlock(value)) return Math.round(MEDIA_TOKEN_ESTIMATE * CHARS_PER_TOKEN);
  let total = 0;
  for (const [key, item] of Object.entries(value)) {
    total += key.length + estimateChars(item, depth + 1);
  }
  return total;
}

/** Token estimate for one message list, system block or tool list. */
export function estimateTokens(value) {
  return Math.ceil(estimateChars(value) / CHARS_PER_TOKEN);
}

/**
 * The conversation array a request body carries, whichever dialect it is in.
 * Returns null when the body has none, which every caller reads as "nothing to
 * shape here" rather than as an error.
 */
export function conversationOf(body) {
  if (!body || typeof body !== 'object') return null;
  if (Array.isArray(body.messages)) return body.messages;
  if (Array.isArray(body.input)) return body.input;
  if (Array.isArray(body.contents)) return body.contents;
  return null;
}

/** Token estimate for the WHOLE request: instructions, tools and conversation. */
export function estimateRequestTokens(body) {
  if (!body || typeof body !== 'object') return 0;
  const parts = [body.system, body.instructions, body.tools, body.systemInstruction];
  let chars = 0;
  for (const part of parts) chars += estimateChars(part);
  chars += estimateChars(conversationOf(body) ?? []);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function fraction(value, fallback) {
  const n = Number(value);
  // A reserve at or above half the window is a misconfiguration, not a policy:
  // it would prune a conversation that fits comfortably.
  return Number.isFinite(n) && n >= 0 && n < 0.5 ? n : fallback;
}

/**
 * Resolve the budget for one request.
 *
 * @param {object} input
 * @param {number} [input.contextWindow] - the model's own window, from
 *   getCapabilitiesForModel. Falsy falls back to DEFAULT_CONTEXT_WINDOW.
 * @param {object} [input.settings] - operator settings. `memoryContextReserveFraction`
 *   and `memoryContextReliefFraction` override the defaults;
 *   `memoryContextWindowOverride` overrides the window itself, for a model whose
 *   advertised window is wrong.
 * @returns {{limit: number, reserve: number, budget: number, target: number}}
 *   `budget` is the ceiling a request may occupy. `target` is where a prune
 *   brings it back to, deliberately below `budget` so one prune lasts.
 */
export function resolveContextBudget({ contextWindow, settings = {} } = {}) {
  const limit = positiveInt(settings?.memoryContextWindowOverride)
    ?? positiveInt(contextWindow)
    ?? DEFAULT_CONTEXT_WINDOW;
  const reserveFraction = fraction(settings?.memoryContextReserveFraction, DEFAULT_RESERVE_FRACTION);
  const reliefFraction = fraction(settings?.memoryContextReliefFraction, DEFAULT_RELIEF_FRACTION);

  const reserve = Math.max(MIN_RESERVE_TOKENS, Math.ceil(limit * reserveFraction));
  // A window smaller than the floor reserve still has to leave something to
  // work with, so the budget is never less than half the window.
  const budget = Math.max(Math.floor(limit / 2), limit - reserve);
  const target = Math.max(1, Math.floor(budget * (1 - reliefFraction)));
  return { limit, reserve, budget, target };
}

// A per-session correction to the character estimate: the provider's own
// prompt count for the last completed request divided by what this module
// estimated for the same body. The 3.8 chars-per-token constant measured
// 3.47 on a synthetic prose-and-tool-output session and near 2.3 on a live
// code-and-JSON heavy Opus session, so an uncalibrated estimate can sit 10%
// to 40% under the number the window is actually enforced against. Bounded
// so one odd response cannot swing the budget by an order of magnitude.
export function calibrationFactor(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(4, Math.max(0.5, n));
}

/**
 * How far over budget one request is, and how much has to go.
 *
 * @returns {{projected: number, budget: number, target: number, limit: number,
 *   over: boolean, deficitTokens: number, deficitChars: number}}
 *   `deficitTokens` is measured against `target`, not `budget`: a prune that
 *   lands exactly on the trigger re-fires next turn.
 */
export function measureContextPressure(body, { contextWindow, settings, calibration } = {}) {
  const { limit, reserve, budget, target } = resolveContextBudget({ contextWindow, settings });
  const cal = calibrationFactor(calibration);
  const projected = Math.ceil(estimateRequestTokens(body) * cal);
  const over = projected > budget;
  const deficitTokens = over ? projected - target : 0;
  return {
    projected,
    limit,
    reserve,
    budget,
    target,
    over,
    deficitTokens,
    calibration: cal,
    // Characters per CALIBRATED token, so a deficit in tokens the provider
    // would count converts to the characters that actually have to go.
    deficitChars: Math.ceil(deficitTokens * (CHARS_PER_TOKEN / cal)),
  };
}
