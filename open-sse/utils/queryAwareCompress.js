// Query-aware compression of the live message prefix.
//
// Historical text blocks (anything older than the last keepRecentTurns
// user/assistant turns) are scored for lexical overlap with the current user
// query. Blocks whose normalized score falls below the threshold are replaced
// by a one-line placeholder; relevant blocks stay verbatim. Fail-open, same
// contract as privacyFilter.js: a query with fewer than 3 usable terms leaves
// the input untouched rather than guessing at relevance.
//
// Deterministic: no randomness, no clock. Pure function, plain-node importable.

import { ELIDE_MARKER_RE } from "../rtk/filters/elide.js";
import { textKey } from "../services/memory/sessionMemo.js";

const PLACEHOLDER_OPEN = '[tokenproxy: earlier turn about "';
const PLACEHOLDER_CLOSE = '" compressed, low relevance to the current query]';
const MAX_NOTES = 8;

// 0.04, not 0.08: at 0.08 the scorer destroyed 79% of on-topic turns for
// +0.3% bytes on the audit fixture; 0.04 has perfect precision on it.
const DEFAULT_THRESHOLD = 0.04;

// Lowercase alphanumeric terms, deduped, in first-appearance order.
function tokenize(text) {
  const seen = new Set();
  const terms = [];
  const matches = String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const term of matches) {
    if (!seen.has(term)) {
      seen.add(term);
      terms.push(term);
    }
  }
  return terms;
}

function wordCount(text) {
  return (String(text).toLowerCase().match(/[a-z0-9]+/g) || []).length;
}

function flattenPreview(text, previewChars) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  // Slice on code points, never UTF-16 units: a cut between a surrogate pair
  // would render a lone half-emoji in the placeholder.
  return Array.from(flat).slice(0, previewChars).join("");
}

function placeholderFor(text, previewChars) {
  return PLACEHOLDER_OPEN + flattenPreview(text, previewChars) + PLACEHOLDER_CLOSE;
}

// Score one block: sum over query terms present in the block of a mild
// length-normalized weight, then normalized by the query term count.
function blockScore(text, queryTerms, termSet) {
  const words = wordCount(text);
  const weight = 1 / (1 + Math.log2(1 + words / 8));
  let score = 0;
  for (const term of queryTerms) {
    if (termSet.has(term)) score += weight;
  }
  return score / queryTerms.length;
}

// Walk from the end counting assistant-or-user turns until keepRecentTurns
// turns are held back; everything before the boundary index is historical.
function historicalBoundary(messages, keepRecentTurns) {
  let held = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = messages[i] && messages[i].role;
    if (role === "user" || role === "assistant") {
      held++;
      if (held >= keepRecentTurns) return i;
    }
  }
  return messages.length;
}

/**
 * Compress low-relevance historical text blocks.
 *
 * Two inputs decide what gets compressed: the query (this turn's user text)
 * and `memo`, the set of block keys this SESSION already compressed on an
 * earlier turn. Blocks in the memo are compressed again whatever the query
 * says, and blocks compressed now are added to it, so the decision is sticky
 * and the prefix the provider cached keeps matching. Without the memo the
 * same historical turn flipped between placeholder and full text from one
 * request to the next (a tool_result turn has no query, so the stage sat
 * out), which rewrote the whole cached prefix twice per tool round.
 *
 * `scoreNew` false applies only the memo: chatCore passes it while the
 * request fits its context budget, so a conversation that is not under
 * pressure loses nothing new.
 *
 * Never grows a block (a placeholder longer than the text it replaces is
 * skipped) and never re-compresses its own placeholder, so applying the
 * function to its output is a fixed point.
 */
function compressPrefixByQuery(messages, options = {}) {
  const query = options.query == null ? "" : String(options.query);
  const keepRecentTurns = options.keepRecentTurns == null ? 2 : options.keepRecentTurns;
  const threshold = options.threshold == null ? DEFAULT_THRESHOLD : options.threshold;
  const previewChars = options.previewChars == null ? 60 : options.previewChars;
  const memo = options.memo instanceof Set ? options.memo : null;
  const scoreNew = options.scoreNew !== false;

  const queryTerms = tokenize(query).filter((term) => term.length >= 3);
  const failOpen = { messages, compressed: 0, notes: [], notesTruncated: false };
  if (!Array.isArray(messages) || messages.length === 0) return failOpen;
  const canScore = scoreNew && queryTerms.length >= 3;
  if (!canScore && !memo?.size) return failOpen;

  const boundary = historicalBoundary(messages, keepRecentTurns);
  if (boundary >= messages.length) return failOpen;

  let newMessages = null;
  let compressed = 0;
  let added = 0;
  const notes = [];
  let notesTruncated = false;

  // A historical block that already carries an rtk elide integrity marker is
  // never placeholder-compressed: the marker is the only proof of what the
  // elided span contained, and qac would destroy it (same rule as R-F5 in
  // toolPruner and the compactor's summarizeMessage).
  const hasElideMarker = (text) =>
    typeof text === "string" && ELIDE_MARKER_RE.test(text);
  const isPlaceholder = (text) =>
    typeof text === "string" && text.startsWith(PLACEHOLDER_OPEN);

  // Decide one block: memo hit, or a fresh score below threshold. Returns
  // the placeholder or null when the block stays.
  const decide = (text) => {
    if (hasElideMarker(text) || isPlaceholder(text)) return null;
    const key = memo ? textKey(text) : null;
    let compress = memo?.has(key) || false;
    if (!compress && canScore) {
      const score = blockScore(text, queryTerms, new Set(tokenize(text)));
      compress = score < threshold;
    }
    if (!compress) return null;
    const placeholder = placeholderFor(text, previewChars);
    if (placeholder.length >= text.length) return null;
    if (memo && !memo.has(key)) { memo.add(key); added++; }
    else if (!memo) added++;
    return placeholder;
  };

  const replaceStringContent = (msg, i) => {
    const placeholder = decide(msg.content);
    if (placeholder === null) return msg;
    if (notes.length < MAX_NOTES) notes.push({ turn: i, preview: flattenPreview(msg.content, previewChars) });
    else notesTruncated = true;
    compressed++;
    return { ...msg, content: placeholder };
  };

  const replaceBlockContent = (msg, i) => {
    let newMsg = null;
    const blocks = msg.content;
    for (let j = 0; j < blocks.length; j++) {
      const block = blocks[j];
      if (!block || block.type !== "text" || typeof block.text !== "string") continue;
      const placeholder = decide(block.text);
      if (placeholder === null) continue;
      if (notes.length < MAX_NOTES) notes.push({ turn: i, preview: flattenPreview(block.text, previewChars) });
      else notesTruncated = true;
      compressed++;
      if (!newMsg) {
        newMsg = { ...msg, content: blocks.slice() };
        if (!newMessages) newMessages = messages.slice();
        newMessages[i] = newMsg;
      }
      newMsg.content[j] = { ...block, text: placeholder };
    }
    return newMsg || msg;
  };

  for (let i = 0; i < boundary; i++) {
    const msg = messages[i];
    if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue;
    if (typeof msg.content === "string") {
      const next = replaceStringContent(msg, i);
      if (next !== msg) {
        if (!newMessages) newMessages = messages.slice();
        newMessages[i] = next;
      }
    } else if (Array.isArray(msg.content)) {
      replaceBlockContent(msg, i);
    }
  }

  if (!newMessages) return { messages, compressed: 0, added: 0, notes: [], notesTruncated: false };
  // `added` counts decisions taken on THIS call (not memo replays): when it
  // is zero the output is what the previous turn already sent.
  return { messages: newMessages, compressed, added, notes, notesTruncated };
}

export { compressPrefixByQuery };
