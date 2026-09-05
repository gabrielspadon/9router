/**
 * Hand-rolled pair dropper for context pressure relief.
 *
 * Under a character deficit, drops the OLDEST complete user/assistant turn
 * pairs, oldest first, until the deficit is covered or no droppable pair
 * remains before the protected recent tail. Tool structure is never touched:
 * a pair is droppable only when neither entry contains tool_use, tool_result,
 * function_call, or function_call_output anywhere in its content (string or
 * blocks, including nested block.content arrays).
 *
 * Options:
 *   deficitChars    number  REQUIRED; characters that must be recovered.
 *                   Values <= 0 return the input unchanged.
 *   keepRecentTurns number  default 6; the last N entries (counting user and
 *                   assistant entries from the end) are never dropped.
 *   protectFirstUser boolean default true; the first user message in the
 *                   array is never dropped (holds the task statement).
 *
 * Returns { messages, droppedPairs, savedChars, notes, notesTruncated }.
 * messages is the input reference when nothing was dropped. Otherwise a new
 * array is returned and every surviving entry is shared by reference.
 */

const TOOL_MARKER_TYPES = new Set([
  "tool_use",
  "tool_result",
  "function_call",
  "function_call_output",
]);

const MAX_DEPTH = 24;

function containsToolMarker(value, depth) {
  if (value === null || typeof value !== "object" || depth > MAX_DEPTH) return false;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (containsToolMarker(item, depth + 1)) return true;
    }
    return false;
  }
  if (TOOL_MARKER_TYPES.has(value.type)) return true;
  for (const key of Object.keys(value)) {
    if (containsToolMarker(value[key], depth + 1)) return true;
  }
  return false;
}

function gatherText(value, depth, out) {
  if (depth > MAX_DEPTH) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) gatherText(item, depth + 1, out);
    return;
  }
  if (value !== null && typeof value === "object") {
    if (typeof value.text === "string") out.push(value.text);
    else if (typeof value.content === "string") out.push(value.content);
    else gatherText(value.content, depth + 1, out);
  }
}

function previewOf(userEntry) {
  const parts = [];
  gatherText(userEntry?.content, 0, parts);
  const flat = parts.join(" ").replace(/\s+/g, " ").trim();
  return flat.slice(0, 60);
}

const NOTES_CAP = 8;

function emptyResult(messages) {
  return { messages, droppedPairs: 0, savedChars: 0, notes: [], notesTruncated: false };
}

export function dropOldestPairs(messages, options = {}) {
  if (!Array.isArray(messages)) return messages;

  const deficitChars = Number(options.deficitChars);
  if (!Number.isFinite(deficitChars) || deficitChars <= 0) return emptyResult(messages);
  if (messages.length === 0) return emptyResult(messages);

  const keepRecentTurns = Math.max(0, Math.floor(Number(options.keepRecentTurns ?? 6)));
  const protectFirstUser = options.protectFirstUser !== false;

  const n = messages.length;
  const tailStart = Math.max(0, n - keepRecentTurns);

  let firstUserIdx = -1;
  if (protectFirstUser) {
    for (let i = 0; i < n; i++) {
      if (messages[i]?.role === "user") {
        firstUserIdx = i;
        break;
      }
    }
  }

  const removed = new Set();
  let savedChars = 0;
  let droppedPairs = 0;
  const notes = [];
  let notesTruncated = false;

  for (let i = 0; i < tailStart; i++) {
    if (savedChars >= deficitChars) break;
    if (messages[i]?.role !== "user") continue;
    if (messages[i + 1]?.role !== "assistant") continue;
    if (protectFirstUser && i === firstUserIdx) {
      i += 1; // skip past the protected assistant so it is not re-examined
      continue;
    }
    if (containsToolMarker(messages[i], 0) || containsToolMarker(messages[i + 1], 0)) {
      i += 1;
      continue;
    }

    removed.add(i);
    removed.add(i + 1);
    savedChars += JSON.stringify(messages[i]).length + JSON.stringify(messages[i + 1]).length;
    droppedPairs += 1;
    if (notes.length < NOTES_CAP) {
      notes.push({ pair: i, preview: previewOf(messages[i]) });
    } else {
      notesTruncated = true;
    }
    i += 1; // loop increment moves past the dropped assistant
  }

  if (droppedPairs === 0) return emptyResult(messages);

  const kept = messages.filter((_, idx) => !removed.has(idx));
  return { messages: kept, droppedPairs, savedChars, notes, notesTruncated };
}
