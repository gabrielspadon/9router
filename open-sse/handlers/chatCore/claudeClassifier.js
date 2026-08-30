import { CLAUDE_BLOCK } from "../../translator/schema/index.js";

const CLASSIFIER_SYSTEM_PREFIX =
  "You are a security monitor for autonomous AI coding agents";
const DECISIONS = new Set(["<block>no</block>", "<block>yes</block>"]);

export const CLAUDE_CLASSIFIER_ERROR_MESSAGE =
  "Claude Code classifier returned an invalid decision; expected exactly <block>no</block> or <block>yes</block>.";

export class ClaudeClassifierValidationError extends Error {
  constructor() {
    super(CLAUDE_CLASSIFIER_ERROR_MESSAGE);
    this.name = "ClaudeClassifierValidationError";
  }

  code = "CLAUDE_CLASSIFIER_INVALID_DECISION";
}

export function isClaudeClassifierRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if (Object.hasOwn(body, "stream")
      && body.stream !== false
      && body.stream !== undefined) return false;

  const systemText = typeof body.system === "string"
    ? body.system
    : Array.isArray(body.system)
      && body.system[0]?.type === CLAUDE_BLOCK.TEXT
      && typeof body.system[0]?.text === "string"
        ? body.system[0].text
        : null;
  if (systemText == null || !systemText.startsWith(CLASSIFIER_SYSTEM_PREFIX)) {
    return false;
  }

  const next = systemText[CLASSIFIER_SYSTEM_PREFIX.length];
  if (next !== undefined && next !== "." && next !== ":" && !/\s/u.test(next)) {
    return false;
  }

  if (!Object.hasOwn(body, "stop_sequences")) return true;
  if (!Array.isArray(body.stop_sequences)) return false;
  if (body.stop_sequences.length === 0) return true;
  return body.stop_sequences.some(
    (value) => typeof value === "string" && value.trim() === "</block>",
  );
}

export async function projectResponsesClassifierStream(body, stream) {
  if (!isClaudeClassifierRequest(body)) return null;
  return { entries: [], evidence: [] };
}

export function projectResponsesClassifierOutput(body, responseBody) {
  if (!isClaudeClassifierRequest(body)) return null;
  return { entries: [], evidence: [] };
}

function projectClaudeContent(content) {
  return content.map((block, blockIndex) => {
    const base = {
      eventOrdinal: null,
      outputIndex: null,
      itemIndex: null,
      blockIndex,
      type: typeof block?.type === "string" ? block.type : null,
      text: null,
    };
    if (block?.type === CLAUDE_BLOCK.TEXT) {
      return typeof block.text === "string"
        ? { ...base, kind: "text", text: block.text }
        : { ...base, kind: "malformed" };
    }
    if (block?.type === CLAUDE_BLOCK.THINKING) {
      return typeof block.thinking === "string"
        ? { ...base, kind: "thinking" }
        : { ...base, kind: "malformed" };
    }
    if (block?.type === CLAUDE_BLOCK.REDACTED_THINKING) {
      return typeof block.data === "string"
        ? { ...base, kind: "thinking" }
        : { ...base, kind: "malformed" };
    }
    if (block?.type === CLAUDE_BLOCK.TOOL_USE) {
      return { ...base, kind: "actionable" };
    }
    return { ...base, kind: "unknown" };
  });
}

function decisionFromEntries(entries, evidence) {
  if (!Array.isArray(entries) || !Array.isArray(evidence)) return null;
  if (evidence.some((record) => record?.resolved !== true)) return null;

  let decision = null;
  for (const entry of entries) {
    if (entry?.kind === "thinking") continue;
    if (entry?.kind !== "text" || typeof entry.text !== "string") return null;
    const candidate = entry.text.trim();
    if (decision !== null || !DECISIONS.has(candidate)) return null;
    decision = candidate;
  }
  return decision;
}

export function validateClaudeClassifierMessage(body, message, projection = null) {
  if (!isClaudeClassifierRequest(body)) return message;
  if (message?.type !== "message"
      || message?.role !== "assistant"
      || !Array.isArray(message?.content)) {
    throw new ClaudeClassifierValidationError();
  }

  const entries = projection === null
    ? projectClaudeContent(message.content)
    : projection?.entries;
  const evidence = projection === null ? [] : projection?.evidence;
  const decision = decisionFromEntries(entries, evidence);
  if (decision === null) throw new ClaudeClassifierValidationError();

  return {
    ...message,
    content: [{ type: CLAUDE_BLOCK.TEXT, text: decision }],
  };
}
