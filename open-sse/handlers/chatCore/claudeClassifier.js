import {
  CLAUDE_BLOCK,
  RESPONSES_ITEM,
  ROLE,
} from "../../translator/schema/index.js";

const CLASSIFIER_SYSTEM_PREFIX =
  "You are a security monitor for autonomous AI coding agents";
const DECISIONS = new Set(["<block>no</block>", "<block>yes</block>"]);
const ACTIONABLE_RESPONSE_TYPES = new Set([
  RESPONSES_ITEM.FUNCTION_CALL,
  RESPONSES_ITEM.FUNCTION_CALL_OUTPUT,
  RESPONSES_ITEM.CUSTOM_TOOL_CALL,
  RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT,
  RESPONSES_ITEM.ADDITIONAL_TOOLS,
]);
const RESPONSES_FRAGMENT_EVENTS = new Set([
  "response.output_item.added",
  "response.content_part.added",
  "response.content_part.done",
  "response.output_text.delta",
  "response.output_text.done",
  "response.reasoning_summary_part.added",
  "response.reasoning_summary_part.done",
  "response.reasoning_summary_text.delta",
  "response.reasoning_summary_text.done",
  "response.function_call_arguments.delta",
  "response.function_call_arguments.done",
  "response.custom_tool_call_input.delta",
  "response.custom_tool_call_input.done",
]);
const RESPONSES_METADATA_EVENTS = new Set([
  "response.created",
  "response.queued",
  "response.in_progress",
]);

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

function projectionEntry(kind, {
  eventOrdinal = null,
  outputIndex = null,
  itemIndex = null,
  blockIndex = null,
  type = null,
  text = null,
} = {}) {
  return {
    kind,
    eventOrdinal,
    outputIndex,
    itemIndex,
    blockIndex,
    type,
    text,
  };
}

function isActionableResponseType(type) {
  return ACTIONABLE_RESPONSE_TYPES.has(type)
    || /(^|_)(?:tool|call)(?:_|$)/u.test(type);
}

function projectResponsesItem(item, metadata) {
  const base = {
    eventOrdinal: metadata.eventOrdinal ?? null,
    outputIndex: metadata.outputIndex ?? null,
    itemIndex: metadata.itemIndex ?? null,
  };
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return [projectionEntry("malformed", base)];
  }

  const type = typeof item.type === "string" ? item.type : null;
  if (type === null) return [projectionEntry("malformed", base)];

  if (type === RESPONSES_ITEM.MESSAGE) {
    if (item.role !== ROLE.ASSISTANT
        || !Array.isArray(item.content)
        || item.content.length === 0) {
      return [projectionEntry("malformed", { ...base, type })];
    }
    return item.content.map((block, blockIndex) => {
      const blockType = typeof block?.type === "string" ? block.type : null;
      const blockBase = { ...base, blockIndex, type: blockType };
      if (blockType === RESPONSES_ITEM.OUTPUT_TEXT) {
        return typeof block.text === "string"
          ? projectionEntry("text", { ...blockBase, text: block.text })
          : projectionEntry("malformed", blockBase);
      }
      return projectionEntry("unknown", blockBase);
    });
  }

  if (type === RESPONSES_ITEM.REASONING) {
    if (!Object.hasOwn(item, "summary")) {
      return [projectionEntry("thinking", { ...base, type, text: null })];
    }
    if (!Array.isArray(item.summary)) {
      return [projectionEntry("malformed", { ...base, type })];
    }
    if (item.summary.length === 0) {
      return [projectionEntry("thinking", { ...base, type, text: null })];
    }
    return item.summary.map((summary, blockIndex) => {
      const summaryType = typeof summary?.type === "string" ? summary.type : null;
      const summaryBase = { ...base, blockIndex, type: summaryType };
      if (summaryType !== RESPONSES_ITEM.SUMMARY_TEXT
          || typeof summary.text !== "string") {
        return projectionEntry("malformed", summaryBase);
      }
      return projectionEntry("thinking", { ...summaryBase, text: summary.text });
    });
  }

  if (isActionableResponseType(type)) {
    return [projectionEntry("actionable", { ...base, type })];
  }
  return [projectionEntry("unknown", { ...base, type })];
}

function projectResponsesOutput(output, eventOrdinal = null, outputIndexes = null) {
  if (!Array.isArray(output) || output.length === 0) {
    return [projectionEntry("malformed", { eventOrdinal, type: "output" })];
  }
  return output.flatMap((item, itemIndex) => projectResponsesItem(item, {
    eventOrdinal,
    outputIndex: outputIndexes?.[itemIndex] ?? null,
    itemIndex,
  }));
}

function structuralEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => structuralEqual(value, right[index]));
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(
      (key) => Object.hasOwn(right, key) && structuralEqual(left[key], right[key]),
    );
}

function parseSseFrame(rawFrame) {
  const lines = rawFrame.replace(/\r\n/gu, "\n").split("\n");
  let eventType = null;
  let hasExplicitEvent = false;
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      hasExplicitEvent = true;
      eventType = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      const data = line.slice(5);
      dataLines.push(data.startsWith(" ") ? data.slice(1) : data);
    }
  }
  if (dataLines.length === 0) return null;
  const data = dataLines.join("\n");
  if (data.trim() === "[DONE]") return { done: true };
  try {
    const parsed = JSON.parse(data);
    return {
      eventType: hasExplicitEvent ? eventType : parsed?.type || "",
      parsed,
    };
  } catch {
    return { malformed: true };
  }
}

function exposesResponsePayload(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  if (Object.hasOwn(parsed, "item") || Object.hasOwn(parsed, "content")) {
    return true;
  }
  const response = parsed.response;
  if (!response || typeof response !== "object" || !Object.hasOwn(response, "output")) {
    return false;
  }
  return !Array.isArray(response.output) || response.output.length > 0;
}

function successfulTerminal(eventType, parsed) {
  if (eventType !== "response.completed" && eventType !== "response.done") {
    return false;
  }
  const status = parsed?.response?.status;
  return status === undefined || status === "completed" || status === "done";
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function buildFragmentEvidence(eventType, parsed, eventOrdinal) {
  const outputIndex = parsed?.output_index;
  let itemId = parsed?.item_id ?? null;
  let itemType = null;
  let blockIndex = null;
  let blockType = null;
  let valid = Number.isInteger(outputIndex) && outputIndex >= 0;

  if (eventType === "response.output_item.added") {
    itemId = parsed?.item?.id ?? null;
    itemType = parsed?.item?.type ?? null;
  } else if (eventType === "response.content_part.added"
      || eventType === "response.content_part.done") {
    itemType = RESPONSES_ITEM.MESSAGE;
    blockIndex = parsed?.content_index;
    blockType = parsed?.part?.type ?? null;
    valid = valid && Number.isInteger(blockIndex) && blockIndex >= 0;
  } else if (eventType === "response.output_text.delta"
      || eventType === "response.output_text.done") {
    itemType = RESPONSES_ITEM.MESSAGE;
    blockIndex = parsed?.content_index;
    blockType = RESPONSES_ITEM.OUTPUT_TEXT;
    valid = valid && Number.isInteger(blockIndex) && blockIndex >= 0;
  } else if (eventType === "response.reasoning_summary_part.added"
      || eventType === "response.reasoning_summary_part.done") {
    itemType = RESPONSES_ITEM.REASONING;
    blockIndex = parsed?.summary_index;
    blockType = parsed?.part?.type ?? null;
    valid = valid && Number.isInteger(blockIndex) && blockIndex >= 0;
  } else if (eventType === "response.reasoning_summary_text.delta"
      || eventType === "response.reasoning_summary_text.done") {
    itemType = RESPONSES_ITEM.REASONING;
    blockIndex = parsed?.summary_index;
    blockType = RESPONSES_ITEM.SUMMARY_TEXT;
    valid = valid && Number.isInteger(blockIndex) && blockIndex >= 0;
  } else if (eventType === "response.function_call_arguments.delta"
      || eventType === "response.function_call_arguments.done") {
    itemType = RESPONSES_ITEM.FUNCTION_CALL;
  } else if (eventType === "response.custom_tool_call_input.delta"
      || eventType === "response.custom_tool_call_input.done") {
    itemType = RESPONSES_ITEM.CUSTOM_TOOL_CALL;
  }

  const evidence = {
    eventOrdinal,
    eventType,
    outputIndex,
    itemId,
    itemType,
    blockIndex,
    blockType,
    resolved: false,
  };
  return {
    evidence,
    valid: valid
      && isNonEmptyString(itemId)
      && isNonEmptyString(itemType)
      && (blockIndex === null || isNonEmptyString(blockType)),
  };
}

export async function projectResponsesClassifierStream(body, stream) {
  if (!isClaudeClassifierRequest(body)) return null;
  const entries = [];
  const evidence = [];
  if (!stream || typeof stream.getReader !== "function") {
    return {
      entries: [projectionEntry("malformed", { type: "stream" })],
      evidence,
    };
  }

  const doneRecords = [];
  const terminalRecords = [];
  const invalidEvidence = new Set();
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buffer = "";
  let eventOrdinal = 0;

  const appendMalformed = (ordinal, outputIndex = null, type = null) => {
    entries.push(projectionEntry("malformed", {
      eventOrdinal: ordinal,
      outputIndex,
      type,
    }));
  };
  const handleFrame = (rawFrame) => {
    const frame = parseSseFrame(rawFrame);
    if (frame === null || frame.done) return;
    const ordinal = eventOrdinal++;
    if (frame.malformed) {
      appendMalformed(ordinal, null, "sse.json");
      return;
    }

    const { eventType, parsed } = frame;
    if (eventType === "response.output_item.done") {
      const outputIndex = parsed?.output_index;
      const item = parsed?.item;
      if (!Number.isInteger(outputIndex) || outputIndex < 0 || !item) {
        appendMalformed(ordinal, Number.isInteger(outputIndex) ? outputIndex : null, eventType);
      }
      if (item) {
        doneRecords.push({ eventOrdinal: ordinal, outputIndex, item });
        entries.push(...projectResponsesItem(item, {
          eventOrdinal: ordinal,
          outputIndex: Number.isInteger(outputIndex) ? outputIndex : null,
          itemIndex: Number.isInteger(outputIndex) ? outputIndex : null,
        }));
      }
      return;
    }

    if (eventType === "response.completed" || eventType === "response.done") {
      terminalRecords.push({ eventOrdinal: ordinal, eventType, parsed });
      if (!successfulTerminal(eventType, parsed)) {
        appendMalformed(ordinal, null, eventType);
      }
      return;
    }

    if (eventType === "response.incomplete" || eventType === "response.failed") {
      terminalRecords.push({ eventOrdinal: ordinal, eventType, parsed });
      appendMalformed(ordinal, null, eventType);
      return;
    }

    if (RESPONSES_FRAGMENT_EVENTS.has(eventType)) {
      const fragment = buildFragmentEvidence(eventType, parsed, ordinal);
      evidence.push(fragment.evidence);
      if (!fragment.valid) {
        invalidEvidence.add(fragment.evidence);
        appendMalformed(ordinal, Number.isInteger(fragment.evidence.outputIndex)
          ? fragment.evidence.outputIndex
          : null, eventType);
      }
      return;
    }
    if (RESPONSES_METADATA_EVENTS.has(eventType)) {
      if (exposesResponsePayload(parsed)) {
        appendMalformed(ordinal, null, eventType);
      }
      return;
    }
    if (parsed?.item || parsed?.content || parsed?.response?.output) {
      appendMalformed(ordinal, null, eventType || null);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let delimiter;
      while ((delimiter = buffer.match(/\r?\n\r?\n/u)) !== null) {
        const rawFrame = buffer.slice(0, delimiter.index);
        buffer = buffer.slice(delimiter.index + delimiter[0].length);
        handleFrame(rawFrame);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleFrame(buffer);
  } finally {
    reader.releaseLock();
  }

  const successfulTerminals = terminalRecords.filter(({ eventType, parsed }) =>
    successfulTerminal(eventType, parsed));
  if (successfulTerminals.length !== 1 || terminalRecords.length !== 1) {
    appendMalformed(null, null, "terminal");
  }

  let authoritativeByIndex = new Map();
  if (successfulTerminals.length === 1 && terminalRecords.length === 1) {
    const terminal = successfulTerminals[0];
    const terminalOutput = terminal.parsed?.response?.output;
    const indexes = doneRecords.map(({ outputIndex }) => outputIndex);
    const doneIndexesValid = indexes.every(Number.isInteger)
      && indexes.every((index) => index >= 0 && index < doneRecords.length)
      && new Set(indexes).size === doneRecords.length;
    if (doneRecords.length > 0 && !doneIndexesValid) {
      appendMalformed(null, null, "response.output_item.done");
    }

    const doneByIndex = new Map();
    for (const record of doneRecords) {
      if (Number.isInteger(record.outputIndex)
          && record.outputIndex >= 0
          && !doneByIndex.has(record.outputIndex)) {
        doneByIndex.set(record.outputIndex, record.item);
      }
    }

    if (doneRecords.length === 0) {
      if (Array.isArray(terminalOutput)) {
        entries.push(...projectResponsesOutput(
          terminalOutput,
          terminal.eventOrdinal,
          terminalOutput.map((_item, index) => index),
        ));
        authoritativeByIndex = new Map(
          terminalOutput.map((item, index) => [index, item]),
        );
      } else {
        appendMalformed(terminal.eventOrdinal, null, "terminal.output");
      }
    } else if (Array.isArray(terminalOutput)) {
      authoritativeByIndex = doneByIndex;
      const terminalMatchesDone = doneIndexesValid
        && terminalOutput.length === doneRecords.length
        && doneRecords.every(({ outputIndex, item }) =>
          structuralEqual(item, terminalOutput[outputIndex]));
      if (!terminalMatchesDone) {
        appendMalformed(terminal.eventOrdinal, null, "terminal.output");
      }
    } else if (terminalOutput !== undefined) {
      authoritativeByIndex = doneByIndex;
      appendMalformed(terminal.eventOrdinal, null, "terminal.output");
    } else {
      authoritativeByIndex = doneByIndex;
    }
  }

  for (const record of evidence) {
    const item = authoritativeByIndex.get(record.outputIndex);
    const blocks = record.itemType === RESPONSES_ITEM.MESSAGE
      ? item?.content
      : record.itemType === RESPONSES_ITEM.REASONING
        ? item?.summary
        : null;
    const block = record.blockIndex === null || !Array.isArray(blocks)
      ? null
      : blocks[record.blockIndex];
    const resolved = !invalidEvidence.has(record)
      && item !== undefined
      && item.id === record.itemId
      && item.type === record.itemType
      && (record.blockIndex === null
        || (block !== undefined && block?.type === record.blockType));
    record.resolved = resolved;
    if (!resolved) {
      appendMalformed(record.eventOrdinal, record.outputIndex, record.eventType);
    }
  }

  return { entries, evidence };
}

export function projectResponsesClassifierOutput(body, responseBody) {
  if (!isClaudeClassifierRequest(body)) return null;
  return {
    entries: projectResponsesOutput(responseBody?.output),
    evidence: [],
  };
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
