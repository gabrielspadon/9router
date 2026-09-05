/**
 * Tool History Pruner (Memory Optimization)
 *
 * Inspired by ai-memory's bounded observation lifecycle:
 * In long-running coding sessions (Claude Code, Cline, Roo, Codex), historical
 * tool_results (file dumps, build logs, diffs) dominate 70-85% of input tokens.
 *
 * This module keeps the full output for the most recent `keepRecentTurns` tool turns,
 * and prunes older historical tool outputs down to `maxHistoricalChars`, appending a clean
 * truncation note so the model retains awareness of past actions without wasting tokens.
 */

const DEFAULT_MAX_CHARS = 800;
const DEFAULT_KEEP_TURNS = 2;

// Error results are evidence, not bulk: rtk/index.js never compresses
// error-flagged tool results, and neither does this pruner. R-F2: error:true
// (strict boolean) and status:'failed' join the flag vocabulary.
function isErrorFlagged(node) {
  if (!node || typeof node !== "object") return false;
  return node.is_error === true || node.isError === true || node.error === true ||
    node.status === "error" || node.status === "failed";
}

// R-F5: a historical result already rewritten by rtk's elide filter carries an
// integrity marker; re-truncating it would destroy the marker, so it is kept
// verbatim, like error evidence. Matches both the current hmac markers and
// sha-era markers written by earlier processes.
const ELIDE_MARKER_RE =
  /\[elided \d+ chars · (?:sha|hmac) [0-9a-f]{8} · head\+tail preserved by tokenproxy\]/;
function hasElideMarker(text) {
  return typeof text === "string" && ELIDE_MARKER_RE.test(text);
}

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

  // R-F5: never re-truncate rtk-elided text — the elide integrity marker must survive.
  if (hasElideMarker(text)) {
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
 * Prune historical tool outputs from a messages array
 * @param {Object} body - Request body containing messages/input/contents
 * @param {Object} options
 * @param {boolean} options.enabled - Whether tool pruning is enabled
 * @param {number} [options.keepRecentTurns=2] - Number of recent tool turns to keep intact
 * @param {number} [options.maxHistoricalChars=800] - Max characters for older tool outputs
 * @returns {{ body: Object, pruned: boolean, savedChars: number, count: number }}
 */
export function pruneHistoricalTools(body, options = {}) {
  const {
    enabled = true,
    keepRecentTurns = DEFAULT_KEEP_TURNS,
    maxHistoricalChars = DEFAULT_MAX_CHARS,
  } = options;

  if (!enabled || !body || typeof body !== "object") {
    return { body, pruned: false, savedChars: 0, count: 0 };
  }

  // Handle standard messages or OpenAI responses input
  const items = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
    ? body.input
    : Array.isArray(body.contents)
    ? body.contents
    : null;

  if (!items || items.length === 0) {
    return { body, pruned: false, savedChars: 0, count: 0 };
  }

  const toolIndices = findToolResultIndices(items);
  if (toolIndices.length <= keepRecentTurns) {
    // All tool results fall within the protected recent window
    return { body, pruned: false, savedChars: 0, count: 0 };
  }

  // Determine the cutoff index: tool results before this index are historical and eligible for pruning
  const historicalToolIndices = new Set(
    toolIndices.slice(0, toolIndices.length - keepRecentTurns)
  );

  let totalSavedChars = 0;
  let prunedCount = 0;

  for (let i = 0; i < items.length; i++) {
    if (!historicalToolIndices.has(i)) continue;
    const msg = items[i];
    if (!msg) continue;
    if (isErrorFlagged(msg)) continue;

    // 1. OpenAI tool/function role with string content
    if ((msg.role === "tool" || msg.role === "function") && typeof msg.content === "string") {
      const res = truncateText(msg.content, maxHistoricalChars);
      if (res.truncated) {
        msg.content = res.text;
        totalSavedChars += res.savedChars;
        prunedCount++;
      }
      continue;
    }

    // 2. OpenAI tool role with array content
    if (msg.role === "tool" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part && !isErrorFlagged(part) && part.type === "text" && typeof part.text === "string") {
          const res = truncateText(part.text, maxHistoricalChars);
          if (res.truncated) {
            part.text = res.text;
            totalSavedChars += res.savedChars;
            prunedCount++;
          }
        }
      }
      continue;
    }

    // 3. OpenAI Responses format
    if (msg.type === "function_call_output") {
      if (typeof msg.output === "string") {
        const res = truncateText(msg.output, maxHistoricalChars);
        if (res.truncated) {
          msg.output = res.text;
          totalSavedChars += res.savedChars;
          prunedCount++;
        }
      } else if (Array.isArray(msg.output)) {
        for (const part of msg.output) {
          if (part && !isErrorFlagged(part) && part.type === "input_text" && typeof part.text === "string") {
            const res = truncateText(part.text, maxHistoricalChars);
            if (res.truncated) {
              part.text = res.text;
              totalSavedChars += res.savedChars;
              prunedCount++;
            }
          }
        }
      }
      continue;
    }

    // 4. Claude format: tool_result content blocks
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block && block.type === "tool_result") {
          if (isErrorFlagged(block)) continue;
          if (typeof block.content === "string") {
            const res = truncateText(block.content, maxHistoricalChars);
            if (res.truncated) {
              block.content = res.text;
              totalSavedChars += res.savedChars;
              prunedCount++;
            }
          } else if (Array.isArray(block.content)) {
            for (const sub of block.content) {
              if (sub && !isErrorFlagged(sub) && sub.type === "text" && typeof sub.text === "string") {
                const res = truncateText(sub.text, maxHistoricalChars);
                if (res.truncated) {
                  sub.text = res.text;
                  totalSavedChars += res.savedChars;
                  prunedCount++;
                }
              }
            }
          }
        }
      }
      continue;
    }

    // 5. Gemini format: parts with functionResponse
    if (Array.isArray(msg.parts)) {
      for (const part of msg.parts) {
        if (part && !isErrorFlagged(part) && part?.functionResponse?.response) {
          const resp = part.functionResponse.response;
          if (typeof resp === "object") {
            const jsonStr = JSON.stringify(resp);
            if (jsonStr.length > maxHistoricalChars) {
              const res = truncateText(jsonStr, maxHistoricalChars);
              if (res.truncated) {
                part.functionResponse.response = { output: res.text };
                totalSavedChars += res.savedChars;
                prunedCount++;
              }
            }
          }
        }
      }
    }
  }

  return {
    body,
    pruned: prunedCount > 0,
    savedChars: totalSavedChars,
    count: prunedCount,
  };
}
