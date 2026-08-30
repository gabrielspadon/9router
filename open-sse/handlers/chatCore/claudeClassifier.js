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
  if (Object.hasOwn(body, "stream") && body.stream !== false) return false;

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

export function validateClaudeClassifierMessage(body, message, projection = null) {
  if (!isClaudeClassifierRequest(body)) return message;
  const content = message?.type === "message"
    && message?.role === "assistant"
    && Array.isArray(message?.content)
      ? message.content
      : null;
  const decision = projection === null
    && content?.length === 1
    && content[0]?.type === CLAUDE_BLOCK.TEXT
    && typeof content[0]?.text === "string"
      ? content[0].text.trim()
      : null;
  if (decision === null || !DECISIONS.has(decision)) {
    throw new ClaudeClassifierValidationError();
  }
  return {
    ...message,
    content: [{ type: CLAUDE_BLOCK.TEXT, text: decision }],
  };
}
