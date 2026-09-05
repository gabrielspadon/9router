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

const PLACEHOLDER_OPEN = '[tokenproxy: earlier turn about "';
const PLACEHOLDER_CLOSE = '" compressed, low relevance to the current query]';
const MAX_NOTES = 8;

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
  return String(text).replace(/\s+/g, " ").trim().slice(0, previewChars);
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

function compressPrefixByQuery(messages, options = {}) {
  const query = options.query == null ? "" : String(options.query);
  const keepRecentTurns = options.keepRecentTurns == null ? 2 : options.keepRecentTurns;
  const threshold = options.threshold == null ? 0.08 : options.threshold;
  const previewChars = options.previewChars == null ? 60 : options.previewChars;

  const queryTerms = tokenize(query).filter((term) => term.length >= 3);
  const failOpen = { messages, compressed: 0, notes: [], notesTruncated: false };
  if (!Array.isArray(messages) || messages.length === 0) return failOpen;
  if (queryTerms.length < 3) return failOpen;

  const boundary = historicalBoundary(messages, keepRecentTurns);
  if (boundary >= messages.length) return failOpen;

  let newMessages = null;
  let compressed = 0;
  const notes = [];
  let notesTruncated = false;

  const replaceStringContent = (msg, i) => {
    const score = blockScore(msg.content, queryTerms, new Set(tokenize(msg.content)));
    if (score >= threshold) return msg;
    const preview = flattenPreview(msg.content, previewChars);
    if (notes.length < MAX_NOTES) notes.push({ turn: i, preview });
    else notesTruncated = true;
    compressed++;
    return { ...msg, content: placeholderFor(msg.content, previewChars) };
  };

  const replaceBlockContent = (msg, i) => {
    let newMsg = null;
    const blocks = msg.content;
    for (let j = 0; j < blocks.length; j++) {
      const block = blocks[j];
      if (!block || block.type !== "text" || typeof block.text !== "string") continue;
      const score = blockScore(block.text, queryTerms, new Set(tokenize(block.text)));
      if (score >= threshold) continue;
      const preview = flattenPreview(block.text, previewChars);
      if (notes.length < MAX_NOTES) notes.push({ turn: i, preview });
      else notesTruncated = true;
      compressed++;
      if (!newMsg) {
        newMsg = { ...msg, content: blocks.slice() };
        if (!newMessages) newMessages = messages.slice();
        newMessages[i] = newMsg;
      }
      newMsg.content[j] = { ...block, text: placeholderFor(block.text, previewChars) };
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

  if (!newMessages) return { messages, compressed: 0, notes: [], notesTruncated: false };
  return { messages: newMessages, compressed, notes, notesTruncated };
}

export { compressPrefixByQuery };
