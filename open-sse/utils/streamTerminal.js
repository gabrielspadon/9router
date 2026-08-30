import { FORMATS } from "../translator/formats.js";
import { buildAbortedResponsesTerminalBytes } from "./responsesStreamHelpers.js";

export const MAX_SSE_TERMINAL_RECORD_BYTES = 64 * 1024;
export const MAX_SSE_TERMINAL_DATA_LINES = 128;

const SUPPORTED_FORMATS = new Set([
  FORMATS.OPENAI,
  FORMATS.CLAUDE,
  FORMATS.OPENAI_RESPONSES,
]);

const RESPONSES_TERMINAL_TYPES = new Set([
  "response.completed",
  "response.done",
  "response.failed",
  "response.incomplete",
]);

const encoder = new TextEncoder();

function utf8ByteLength(character) {
  const codePoint = character.codePointAt(0);
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function dataValue(line) {
  const value = line.slice(5);
  return value.startsWith(" ") ? value.slice(1) : value;
}

function buildOpenAIIncompleteTerminal() {
  return encoder.encode(
    `data: ${JSON.stringify({
      error: {
        message: "stream closed before terminal event",
        type: "server_error",
        code: "stream_incomplete",
      },
    })}\n\ndata: [DONE]\n\n`,
  );
}

function buildClaudeIncompleteTerminal() {
  return encoder.encode(
    `event: error\ndata: ${JSON.stringify({
      type: "error",
      error: {
        type: "api_error",
        message: "stream closed before terminal event",
      },
    })}\n\n`,
  );
}

/**
 * Observe complete client-emitted SSE records without changing their bytes.
 * Returns null when the emitted protocol has no exact terminal predicate.
 */
export function createSseTerminalObserver(emittedFormat) {
  if (!SUPPORTED_FORMATS.has(emittedFormat)) return null;

  let decoder = new TextDecoder("utf-8", { fatal: false });
  let released = false;
  let terminal = false;
  let discarding = false;
  let discardLineHasContent = false;
  let recordBytes = 0;
  let dataLineCount = 0;
  let eventName = null;
  let dataLines = [];
  let currentLine = "";

  const resetRecord = () => {
    recordBytes = 0;
    dataLineCount = 0;
    eventName = null;
    dataLines = [];
    currentLine = "";
  };

  const beginDiscard = () => {
    resetRecord();
    discarding = true;
    discardLineHasContent = false;
  };

  const recordHasTerminal = () => {
    if (emittedFormat === FORMATS.OPENAI) {
      if (dataLines.length === 1 && dataLines[0].trim() === "[DONE]") return true;
      try {
        const payload = JSON.parse(dataLines.join("\n"));
        return Array.isArray(payload?.choices)
          && payload.choices.some((choice) => choice?.finish_reason != null);
      } catch {
        return false;
      }
    }

    if (emittedFormat === FORMATS.CLAUDE) {
      try {
        const payloadType = JSON.parse(dataLines.join("\n"))?.type;
        return eventName === null
          ? payloadType === "message_stop"
          : eventName === "message_stop" && payloadType === "message_stop";
      } catch {
        return false;
      }
    }

    try {
      const payloadType = JSON.parse(dataLines.join("\n"))?.type;
      if (eventName !== null && typeof payloadType === "string") {
        return eventName === payloadType && RESPONSES_TERMINAL_TYPES.has(eventName);
      }
      return eventName === null
        ? RESPONSES_TERMINAL_TYPES.has(payloadType)
        : RESPONSES_TERMINAL_TYPES.has(eventName);
    } catch {
      return RESPONSES_TERMINAL_TYPES.has(eventName);
    }
  };

  const finishLine = () => {
    const line = currentLine.endsWith("\r") ? currentLine.slice(0, -1) : currentLine;
    currentLine = "";

    if (line === "") {
      if (recordHasTerminal()) terminal = true;
      resetRecord();
      return;
    }

    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      return;
    }

    if (line.startsWith("data:")) {
      dataLineCount += 1;
      if (dataLineCount > MAX_SSE_TERMINAL_DATA_LINES) {
        beginDiscard();
        return;
      }
      dataLines.push(dataValue(line));
    }
  };

  const observeCharacter = (character) => {
    if (discarding) {
      if (character === "\n") {
        if (!discardLineHasContent) {
          discarding = false;
          resetRecord();
        }
        discardLineHasContent = false;
      } else if (character !== "\r") {
        discardLineHasContent = true;
      }
      return;
    }

    recordBytes += utf8ByteLength(character);
    const isBlankBoundary = character === "\n"
      && currentLine.replace(/\r$/, "") === "";
    if (recordBytes > MAX_SSE_TERMINAL_RECORD_BYTES) {
      if (isBlankBoundary) resetRecord();
      else beginDiscard();
      return;
    }

    if (character === "\n") {
      finishLine();
      return;
    }

    currentLine += character;
  };

  return {
    observe(bytes) {
      if (released || terminal || !bytes) return;
      const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      // Keep decoded/parser state bounded even if a provider sends a very large
      // transport chunk. TextDecoder retains only a partial UTF-8 code point.
      for (let offset = 0; offset < input.byteLength; offset += 4096) {
        const text = decoder.decode(input.subarray(offset, offset + 4096), { stream: true });
        for (const character of text) observeCharacter(character);
      }
    },

    sawTerminal() {
      return terminal;
    },

    buildIncompleteTerminal() {
      if (emittedFormat === FORMATS.OPENAI) return buildOpenAIIncompleteTerminal();
      if (emittedFormat === FORMATS.CLAUDE) return buildClaudeIncompleteTerminal();
      return buildAbortedResponsesTerminalBytes();
    },

    release() {
      if (released) return;
      released = true;
      discarding = false;
      discardLineHasContent = false;
      resetRecord();
      decoder = new TextDecoder("utf-8", { fatal: false });
    },
  };
}
