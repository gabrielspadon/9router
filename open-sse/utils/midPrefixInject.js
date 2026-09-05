// Mid-prefix injection. After earlier turns were optimized (compressed,
// dropped, reordered, stripped), a single short note lands at the boundary
// of the kept region so the model keeps a map of what the earlier region
// once contained. Never mutates caller input; the target message is always
// a fresh object inside a fresh array.

const NOTE_PREFIX = "[tokenproxy context note] ";
const NOTE_HEAD = "Earlier turns were optimized: ";
const DEFAULT_MAX_NOTES = 8;
const DEFAULT_NOTE_CHARS = 160;

const isUserMessage = (m) => m?.role === "user";

function findTargetIndex(messages, insertIndex) {
  if (isUserMessage(messages[insertIndex])) return insertIndex;
  for (let i = insertIndex + 1; i < messages.length; i++) {
    if (isUserMessage(messages[i])) return i;
  }
  for (let i = insertIndex - 1; i >= 0; i--) {
    if (isUserMessage(messages[i])) return i;
  }
  return -1;
}

function withNoteBlock(message, noteText) {
  const noteBlock = { type: "text", text: NOTE_PREFIX + noteText };
  const content = typeof message.content === "string"
    ? [{ type: "text", text: message.content }, noteBlock]
    : [...(message.content || []), noteBlock];
  return { ...message, content };
}

export function injectBoundaryNote(messages, insertIndex, noteText, options = {}) {
  void options;
  if (typeof noteText !== "string" || noteText.trim().length === 0) {
    return { messages, injected: false };
  }
  if (!Array.isArray(messages) || insertIndex < 0 || insertIndex >= messages.length) {
    return { messages, injected: false };
  }
  const targetIndex = findTargetIndex(messages, insertIndex);
  if (targetIndex === -1) {
    return { messages, injected: false };
  }
  const nextMessages = messages.slice();
  nextMessages[targetIndex] = withNoteBlock(messages[targetIndex], noteText);
  return { messages: nextMessages, injected: true, targetIndex };
}

export function composeBoundaryNote(notes, options = {}) {
  if (!Array.isArray(notes) || notes.length === 0) return "";
  const maxNotes = options.maxNotes ?? DEFAULT_MAX_NOTES;
  const noteChars = options.noteChars ?? DEFAULT_NOTE_CHARS;
  const entries = notes
    .filter(n => n && typeof n.text === "string")
    .slice(-maxNotes)
    .map(n => `${n.kind || "note"}: ${n.text.replace(/\s+/g, " ").trim().slice(0, noteChars)}`)
    .filter(e => !e.endsWith(": "));
  return entries.length === 0 ? "" : NOTE_HEAD + entries.join(" · ");
}
