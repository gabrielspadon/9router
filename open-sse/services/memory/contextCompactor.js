/**
 * Sliding Window Context Compactor (Memory Optimization)
 *
 * Inspired by ai-memory's session distillation and compaction:
 * When conversations span 30-100+ turns, passing the entire raw message history
 * can exhaust provider context limits, cause latency spikes, and generate massive costs.
 *
 * This module monitors total message payload size/token estimate. When the threshold is
 * crossed, it preserves the system instruction and the most recent `recentTurnsToKeep` turns,
 * while consolidating older turns into a structured summary block.
 */

const DEFAULT_THRESHOLD_TOKENS = 32000;
const DEFAULT_RECENT_TURNS = 8;
const CHARS_PER_TOKEN_ESTIMATE = 3.8;

/**
 * Fast conservative token estimation
 * @param {Array} items
 * @returns {number}
 */
export function estimateTokenCount(items) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  try {
    const rawLength = JSON.stringify(items).length;
    return Math.ceil(rawLength / CHARS_PER_TOKEN_ESTIMATE);
  } catch {
    return 0;
  }
}

/**
 * Extract concise text summary from a message item
 * @param {Object} msg
 * @returns {string}
 */
function summarizeMessage(msg) {
  if (!msg) return "";
  const role = msg.role || (msg.type === "function_call_output" ? "tool" : "user");
  let contentText = "";

  if (typeof msg.content === "string") {
    contentText = msg.content;
  } else if (Array.isArray(msg.content)) {
    contentText = msg.content
      .map((c) => (c?.type === "text" ? c.text : c?.type === "tool_use" ? `[called tool: ${c.name}]` : c?.type === "tool_result" ? `[tool result: ${typeof c.content === "string" ? c.content.slice(0, 100) : "output"}]` : ""))
      .filter(Boolean)
      .join(" ");
  } else if (typeof msg.output === "string") {
    contentText = msg.output;
  } else if (Array.isArray(msg.parts)) {
    contentText = msg.parts
      .map((p) => p.text || (p.functionCall ? `[call: ${p.functionCall.name}]` : p.functionResponse ? `[result: ${p.functionResponse.name}]` : ""))
      .filter(Boolean)
      .join(" ");
  }

  // Bound the per-message summary to max 300 chars for the summary block
  const cleaned = contentText.replace(/\s+/g, " ").trim();
  const truncated = cleaned.length > 250 ? `${cleaned.slice(0, 250)}...` : cleaned;
  return truncated ? `- **${role.toUpperCase()}**: ${truncated}` : "";
}

/**
 * Compact older conversation history into a structured summary
 * @param {Object} body - Request body
 * @param {Object} options
 * @param {boolean} options.enabled - Whether compaction is enabled
 * @param {number} [options.thresholdTokens=32000] - Token threshold to trigger compaction
 * @param {number} [options.recentTurnsToKeep=8] - Number of recent turns to keep intact
 * @returns {{ body: Object, compacted: boolean, originalTokens: number, newTokens: number }}
 */
export function compactContextWindow(body, options = {}) {
  const {
    enabled = false,
    thresholdTokens = DEFAULT_THRESHOLD_TOKENS,
    recentTurnsToKeep = DEFAULT_RECENT_TURNS,
  } = options;

  if (!enabled || !body || typeof body !== "object") {
    return { body, compacted: false, originalTokens: 0, newTokens: 0 };
  }

  const items = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
    ? body.input
    : null;

  if (!items || items.length <= recentTurnsToKeep + 2) {
    return { body, compacted: false, originalTokens: 0, newTokens: 0 };
  }

  const originalTokens = estimateTokenCount(items);
  if (originalTokens < thresholdTokens) {
    return { body, compacted: false, originalTokens, newTokens: originalTokens };
  }

  // Preserve system messages at the start
  const systemMessages = [];
  let conversationStartIndex = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i]?.role === "system") {
      systemMessages.push(items[i]);
      conversationStartIndex = i + 1;
    } else {
      break;
    }
  }

  const conversationalItems = items.slice(conversationStartIndex);
  if (conversationalItems.length <= recentTurnsToKeep) {
    return { body, compacted: false, originalTokens, newTokens: originalTokens };
  }

  const splitIndex = conversationalItems.length - recentTurnsToKeep;
  const olderItems = conversationalItems.slice(0, splitIndex);
  const recentItems = conversationalItems.slice(splitIndex);

const SUMMARY_MARKER = "[Historical Context Summary by tokenproxy Memory Optimizer]";
const SECTION_FALLBACK = "none recorded";
const FILE_PATH_RE = /(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,10}/g;
const DECISION_RE = /\b(decided|decision|agreed|chosen|chose|settled|will use|going with|opted)\b/i;
const ERROR_RE = /\b(error|errors|failed|failure|exception|broken|crash(?:ed)?|stack trace|fix(?:ed|es)?|bug|regression|workaround|panic)\b/i;
const PENDING_RE = /\b(todo|pending|follow[- ]?up|remaining|blocked|next step|not yet|fixme|still needs?|open item)\b/i;

function textOf(msg) {
  if (!msg) return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((c) => c && c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join(" ");
  }
  return "";
}

// Structured checklist summary (deterministic extraction, no model call):
// Intent, Decisions, Files, Errors and fixes, Pending, Next as compact labeled
// lines. Sections without keyword matches fall back to raw per-message lines so
// representative content is kept even when the history names nothing explicitly.
function buildSummary(olderItems) {
  const highlights = olderItems.map(summarizeMessage).filter(Boolean).slice(-20);

  const convo = olderItems.filter((m) => m.role === "user" || m.role === "assistant");
  const firstUser = convo.find((m) => m.role === "user");
  const lastUser = convo.length > 0 ? convo[convo.length - 1] : null;
  const clip = (t) => {
    const flat = t.replace(/\s+/g, " ").trim();
    return flat.length > 200 ? flat.slice(0, 200) + "…" : flat;
  };
  const intent = firstUser ? clip(textOf(firstUser)) : SECTION_FALLBACK;
  const next = lastUser ? clip(textOf(lastUser)) : SECTION_FALLBACK;

  const decisionHits = highlights.filter((h) => DECISION_RE.test(h));
  const errorHits = highlights.filter((h) => ERROR_RE.test(h));
  const picked = new Set([...decisionHits, ...errorHits]);
  const rest = highlights.filter((h) => !picked.has(h));
  // Fallback keeps EVERY unmatched highlight (split across the two sections)
  // so the pre-checklist guarantee, all of the last 20 per-message lines, holds.
  const decisionLines =
    decisionHits.length > 0 ? decisionHits.slice(0, 3) : rest.slice(0, Math.ceil(rest.length / 2));
  const errorLines =
    errorHits.length > 0 ? errorHits.slice(0, 4) : rest.slice(Math.ceil(rest.length / 2));

  const seenPaths = new Set();
  const files = [];
  for (const item of olderItems) {
    for (const m of textOf(item).matchAll(FILE_PATH_RE)) {
      if (!seenPaths.has(m[0])) {
        seenPaths.add(m[0]);
        files.push(m[0]);
        if (files.length >= 10) break;
      }
    }
    if (files.length >= 10) break;
  }

  const pendingHits = highlights.filter((h) => PENDING_RE.test(h)).slice(0, 3);

  return [
    SUMMARY_MARKER,
    `Notice: Earlier conversation turns (${olderItems.length} messages) have been compacted to conserve context window.`,
    `Intent: ${intent || SECTION_FALLBACK}`,
    `Decisions: ${decisionLines.length > 0 ? decisionLines.join("; ") : SECTION_FALLBACK}`,
    `Files: ${files.length > 0 ? files.join(", ") : SECTION_FALLBACK}`,
    `Errors and fixes: ${errorLines.length > 0 ? errorLines.join("; ") : SECTION_FALLBACK}`,
    `Pending: ${pendingHits.length > 0 ? pendingHits.join("; ") : SECTION_FALLBACK}`,
    `Next: ${next || SECTION_FALLBACK}`,
  ].join("\n");
}

  const summaryContent = buildSummary(olderItems);

  // Both compaction blocks carry role "system", not "user"/"assistant" (#2187).
  // The original shape put a summary INTO a fabricated user turn and then had
  // a fabricated assistant turn "acknowledge" it -- a model was told the user
  // said something they never said, and that it replied to it, which is the
  // exact shape prompt-injection training flags on tool-history content.
  // Framing both blocks as system-scoped notices instead removes the invented
  // dialogue while keeping the same two-message slot so recentItems still
  // follow immediately after.
  const summaryMessage = {
    role: "system",
    content: summaryContent,
  };

  const compactionNotice = {
    role: "system",
    content: "The summary above replaces the compacted turns above it; continue the conversation using it as context.",
  };

  const compactedMessages = [
    ...systemMessages,
    summaryMessage,
    compactionNotice,
    ...recentItems,
  ];

  if (Array.isArray(body.messages)) {
    body.messages = compactedMessages;
  } else if (Array.isArray(body.input)) {
    body.input = compactedMessages;
  }

  const newTokens = estimateTokenCount(compactedMessages);

  return {
    body,
    compacted: true,
    originalTokens,
    newTokens,
    savedTokens: Math.max(0, originalTokens - newTokens),
  };
}
