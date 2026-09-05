/**
 * Tool History Pruner (Memory Optimization)
 *
 * In long-running coding sessions (Claude Code, Cline, Roo, Codex), historical
 * tool_results (file dumps, build logs, diffs) dominate 70-85% of input tokens.
 *
 * PROGRESSIVE, AND ONLY UNDER PRESSURE (2026-09-04). This module used to keep
 * the last two tool turns at full size and truncate every earlier tool result
 * to 800 characters, on every request, whether or not the request came anywhere
 * near the model's window. Measured on the RTX seam over six hours that
 * discarded 212 million tokens of history across 5,008 requests — median
 * 29,000 per request, 166,000 at the worst — against a one-million token
 * window, with sessions plateauing near 350,000 because the pruner would not
 * let them grow. It also moved the truncation boundary every turn (it is
 * counted from the end of the conversation), so the prompt prefix was rewritten
 * on every request and the cache died with it.
 *
 * So pruning is now demand-driven. The caller measures how far over budget the
 * request is (contextBudget.js) and passes the overflow as `deficitChars`. With
 * no overflow nothing is touched at all. With an overflow, the oldest tool
 * results are trimmed first and in TIERS — a generous cap first, tighter caps
 * only if the overflow survives — and the walk stops the moment the overflow is
 * covered. Least information lost for the tokens that have to be found, and a
 * prefix that stays byte-stable until the ceiling genuinely forces a change.
 *
 * The flat legacy path is still here and still the default when no budget is
 * supplied, so a caller that has not been taught about budgets keeps working.
 */

const DEFAULT_MAX_CHARS = 800;
const DEFAULT_KEEP_TURNS = 2;

// Error results are evidence, not bulk: rtk/index.js:8-13 never compresses
// is_error/isError/status:'error' tool results, and neither does this pruner.
function isErrorFlagged(node) {
  if (!node || typeof node !== "object") return false;
  return node.is_error === true || node.isError === true || node.status === "error";
}

// Truncation caps, generous to tight. A tier is applied to every historical
// tool turn, oldest first, and the next tier is only reached if the overflow
// is still not covered. The last tier is the old flat default, which is now
// the floor under real pressure rather than the everyday behavior.
export const PRESSURE_TIERS = Object.freeze([20_000, 8_000, 3_000, 1_200, 400]);

// How many recent tool turns are never touched in pressure mode. The old value
// of 2 was what made the boundary move every turn; a working set this size
// covers the tool output a model is actually still reasoning about, and it only
// shrinks the pruning candidates rather than the protection.
export const DEFAULT_PRESSURE_KEEP_TURNS = 20;

/**
 * Truncate a single text block if it exceeds maxChars
 * @param {string} text
 * @param {number} maxChars
 * @returns {{ text: string, truncated: boolean, savedChars: number }}
 */
function truncateText(text, maxChars) {
  if (typeof text !== "string" || text.length <= maxChars) {
    return { text, truncated: false, savedChars: 0 };
  }

  const originalLength = text.length;
  const lineCount = (text.match(/\n/g) || []).length;
  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = Math.floor(maxChars * 0.3);

  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);
  const omittedChars = originalLength - (headChars + tailChars);
  const omittedLines = Math.max(1, Math.floor(lineCount * (omittedChars / originalLength)));

  const notice = `\n[... Tool output truncated by tokenproxy memory optimizer: ${omittedLines} lines / ${omittedChars} chars omitted ...]\n`;
  const truncatedText = `${head}${notice}${tail}`;

  return {
    text: truncatedText,
    truncated: true,
    savedChars: Math.max(0, originalLength - truncatedText.length),
  };
}

/**
 * Identify indices of messages containing tool outputs
 * @param {Array} items - messages or input array
 * @returns {number[]} Array of message indices that contain tool results
 */
function findToolResultIndices(items) {
  const indices = [];
  if (!Array.isArray(items)) return indices;

  for (let i = 0; i < items.length; i++) {
    const msg = items[i];
    if (!msg) continue;

    // OpenAI format: role === "tool" or role === "function"
    if (msg.role === "tool" || msg.role === "function") {
      indices.push(i);
      continue;
    }

    // OpenAI Responses format: type === "function_call_output"
    if (msg.type === "function_call_output") {
      indices.push(i);
      continue;
    }

    // Claude format: role === "user" with content array containing tool_result blocks
    if (Array.isArray(msg.content) && msg.content.some((b) => b?.type === "tool_result")) {
      indices.push(i);
      continue;
    }

    // Gemini format: parts containing functionResponse
    if (Array.isArray(msg.parts) && msg.parts.some((p) => p?.functionResponse)) {
      indices.push(i);
      continue;
    }
  }

  return indices;
}

/**
 * Truncate every tool output carried by ONE message to `maxChars`.
 *
 * Extracted so the flat path and the tiered pressure path share one dialect
 * table: a format handled in one and forgotten in the other is how a provider
 * quietly stops being pruned at all.
 *
 * @returns {{savedChars: number, count: number}}
 */
function truncateMessageTools(msg, maxChars) {
  let savedChars = 0;
  let count = 0;
  if (!msg) return { savedChars, count };
  if (isErrorFlagged(msg)) return { savedChars, count };

  const take = (res) => {
    if (!res.truncated) return false;
    savedChars += res.savedChars;
    count += 1;
    return true;
  };

  // 1. OpenAI tool/function role with string content
  if ((msg.role === "tool" || msg.role === "function") && typeof msg.content === "string") {
    const res = truncateText(msg.content, maxChars);
    if (take(res)) msg.content = res.text;
    return { savedChars, count };
  }

  // 2. OpenAI tool role with array content
  if (msg.role === "tool" && Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part && !isErrorFlagged(part) && part.type === "text" && typeof part.text === "string") {
        const res = truncateText(part.text, maxChars);
        if (take(res)) part.text = res.text;
      }
    }
    return { savedChars, count };
  }

  // 3. OpenAI Responses format
  if (msg.type === "function_call_output") {
    if (typeof msg.output === "string") {
      const res = truncateText(msg.output, maxChars);
      if (take(res)) msg.output = res.text;
    } else if (Array.isArray(msg.output)) {
      for (const part of msg.output) {
        if (part && !isErrorFlagged(part) && part.type === "input_text" && typeof part.text === "string") {
          const res = truncateText(part.text, maxChars);
          if (take(res)) part.text = res.text;
        }
      }
    }
    return { savedChars, count };
  }

  // 4. Claude format: tool_result content blocks
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (!block || block.type !== "tool_result") continue;
      if (isErrorFlagged(block)) continue;
      if (typeof block.content === "string") {
        const res = truncateText(block.content, maxChars);
        if (take(res)) block.content = res.text;
      } else if (Array.isArray(block.content)) {
        for (const sub of block.content) {
          if (sub && !isErrorFlagged(sub) && sub.type === "text" && typeof sub.text === "string") {
            const res = truncateText(sub.text, maxChars);
            if (take(res)) sub.text = res.text;
          }
        }
      }
    }
    return { savedChars, count };
  }

  // 5. Gemini format: parts with functionResponse
  if (Array.isArray(msg.parts)) {
    for (const part of msg.parts) {
      if (isErrorFlagged(part)) continue;
      if (!part?.functionResponse?.response) continue;
      const resp = part.functionResponse.response;
      if (typeof resp !== "object") continue;
      const jsonStr = JSON.stringify(resp);
      if (jsonStr.length <= maxChars) continue;
      const res = truncateText(jsonStr, maxChars);
      if (take(res)) part.functionResponse.response = { output: res.text };
    }
  }

  return { savedChars, count };
}

/**
 * Prune historical tool outputs from a messages array.
 *
 * @param {Object} body - Request body containing messages/input/contents
 * @param {Object} options
 * @param {boolean} options.enabled - Whether tool pruning is enabled
 * @param {number} [options.keepRecentTurns] - tool turns never touched. Defaults
 *   to 2 on the flat path and DEFAULT_PRESSURE_KEEP_TURNS under a budget.
 * @param {number} [options.maxHistoricalChars=800] - flat-path cap. Ignored
 *   when `deficitChars` is supplied.
 * @param {number} [options.deficitChars=0] - characters that HAVE to go, from
 *   measureContextPressure. Zero or absent with `budgetAware` set means the
 *   request fits and nothing is pruned. Zero or absent without it means the
 *   caller has not been taught about budgets, so the flat path runs.
 * @param {boolean} [options.budgetAware=false] - the caller measured pressure
 *   and is telling us so. Distinguishes "measured, and there is no overflow"
 *   from "never measured".
 * @param {number[]} [options.tiers=PRESSURE_TIERS]
 * @returns {{ body: Object, pruned: boolean, savedChars: number, count: number,
 *   tiersUsed: number, remainingChars: number }}
 */
export function pruneHistoricalTools(body, options = {}) {
  const {
    enabled = true,
    keepRecentTurns,
    maxHistoricalChars = DEFAULT_MAX_CHARS,
    deficitChars = 0,
    budgetAware = false,
    tiers = PRESSURE_TIERS,
  } = options;

  const idle = { body, pruned: false, savedChars: 0, count: 0, tiersUsed: 0, remainingChars: 0 };
  if (!enabled || !body || typeof body !== "object") return idle;

  // Handle standard messages or OpenAI responses input
  const items = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
    ? body.input
    : Array.isArray(body.contents)
    ? body.contents
    : null;

  if (!items || items.length === 0) return idle;

  // MEASURED AND FITTING. The request is inside the window less its reserve, so
  // there is nothing to buy by cutting history and everything to lose: the
  // model keeps the whole conversation and the prefix stays byte-identical to
  // the one the provider already has cached.
  if (budgetAware && deficitChars <= 0) return idle;

  const protectTurns = Number.isFinite(Number(keepRecentTurns))
    ? Math.max(0, Math.floor(Number(keepRecentTurns)))
    : (budgetAware ? DEFAULT_PRESSURE_KEEP_TURNS : DEFAULT_KEEP_TURNS);

  const toolIndices = findToolResultIndices(items);
  if (toolIndices.length <= protectTurns) {
    // Every tool result falls inside the protected recent window.
    return idle;
  }
  const historical = toolIndices.slice(0, toolIndices.length - protectTurns);

  let totalSavedChars = 0;
  let prunedCount = 0;

  // FLAT PATH. One cap, every historical turn, no notion of a budget. Kept for
  // callers that have not been given a measurement.
  if (!budgetAware) {
    for (const i of historical) {
      const res = truncateMessageTools(items[i], maxHistoricalChars);
      totalSavedChars += res.savedChars;
      prunedCount += res.count;
    }
    return {
      body,
      pruned: prunedCount > 0,
      savedChars: totalSavedChars,
      count: prunedCount,
      tiersUsed: totalSavedChars > 0 ? 1 : 0,
      remainingChars: 0,
    };
  }

  // TIERED PATH. Oldest first, generous cap first, and stop as soon as the
  // overflow is covered. Each tier is a strictly tighter cap, so a turn already
  // trimmed by an earlier tier is only revisited when the overflow survived it —
  // which is what makes the pressure progressive instead of a step function.
  let remaining = deficitChars;
  let tiersUsed = 0;
  const caps = Array.isArray(tiers) && tiers.length ? tiers : PRESSURE_TIERS;

  for (const cap of caps) {
    if (remaining <= 0) break;
    tiersUsed += 1;
    for (const i of historical) {
      if (remaining <= 0) break;
      const res = truncateMessageTools(items[i], cap);
      if (res.savedChars > 0) {
        totalSavedChars += res.savedChars;
        prunedCount += res.count;
        remaining -= res.savedChars;
      }
    }
  }

  return {
    body,
    pruned: prunedCount > 0,
    savedChars: totalSavedChars,
    count: prunedCount,
    tiersUsed,
    // Above zero means even the tightest tier could not find enough. The
    // caller escalates to media pruning and then to compaction rather than
    // this module cutting into the protected recent turns.
    remainingChars: Math.max(0, remaining),
  };
}
