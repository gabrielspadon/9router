// Strips thinking / redacted_thinking blocks from historical assistant turns
// before a request crosses the wire. The most recent assistant turn keeps its
// thinking: it is the live reasoning chain the provider still builds on.
// Historical turns pay full token cost for reasoning the model cannot act on.

const PLACEHOLDER_TEXT = "[tokenproxy: prior reasoning stripped to save context]";
const STRIP_TYPES = new Set(["thinking", "redacted_thinking"]);

function positiveInt(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

// Returns { messages, stripped, notes, notesTruncated? }. When nothing is
// removed, `messages` is the input array itself (same reference).
export function stripHistoricalThinking(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages, stripped: 0, notes: [] };
  }

  const keepRecentTurns = positiveInt(options.keepRecentTurns, 1);
  const notesMax = positiveInt(options.notesMax, 8);

  const assistantTurns = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "assistant") assistantTurns.push(i);
  }
  if (assistantTurns.length === 0) {
    return { messages, stripped: 0, notes: [] };
  }

  const keptTurns = new Set(assistantTurns.slice(Math.max(0, assistantTurns.length - keepRecentTurns)));

  let stripped = 0;
  const notes = [];
  let notesTruncated = false;
  const out = new Array(messages.length);
  let changed = false;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (
      !message
      || message.role !== "assistant"
      || keptTurns.has(i)
      || !Array.isArray(message.content)
    ) {
      out[i] = message;
      continue;
    }

    const removed = message.content.reduce((n, block) => n + (STRIP_TYPES.has(block?.type) ? 1 : 0), 0);
    if (removed === 0) {
      out[i] = message;
      continue;
    }

    const content = message.content.filter((block) => !STRIP_TYPES.has(block?.type));
    if (content.length === 0) {
      // A content-less assistant message is a wire error; leave a marker.
      content.push({ type: "text", text: PLACEHOLDER_TEXT });
    }
    out[i] = { ...message, content };
    stripped += removed;
    changed = true;

    if (notes.length < notesMax) {
      notes.push({ turn: i, blocks: removed });
    } else {
      notesTruncated = true;
    }
  }

  if (!changed) {
    return { messages, stripped: 0, notes: [] };
  }
  const result = { messages: out, stripped, notes };
  if (notesTruncated) result.notesTruncated = true;
  return result;
}
