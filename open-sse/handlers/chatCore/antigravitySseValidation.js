import {
  ANTIGRAVITY_SAFE_ERROR_MESSAGE,
  ANTIGRAVITY_VERIFICATION_REQUIRED_MESSAGE,
  classifyAntigravityValidation,
  isAntigravityErrorPayload,
} from "../../services/antigravityValidation.js";

const MAX_SSE_VALIDATION_FRAME_BYTES = 64 * 1024;
const encoder = new TextEncoder();

function nextSseEvent(text) {
  const lf = text.indexOf("\n\n");
  const crlf = text.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) {
    return { event: text.slice(0, crlf + 4), rest: text.slice(crlf + 4) };
  }
  return { event: text.slice(0, lf + 2), rest: text.slice(lf + 2) };
}

function inspectSseEvent(event) {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  if (data.length === 0) return null;
  try {
    const payload = JSON.parse(data.join("\n"));
    const status = payload?.error?.code ?? payload?.error?.status ?? payload?.status;
    const validation = classifyAntigravityValidation({ status, payload, source: "chat" });
    if (validation) return { kind: "validation", validation };
    return isAntigravityErrorPayload(payload) ? { kind: "error" } : null;
  } catch {
    return null;
  }
}

function exceedsFrameLimit(text) {
  return encoder.encode(text).byteLength > MAX_SSE_VALIDATION_FRAME_BYTES;
}

function concatChunks(chunks, totalBytes) {
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function classifyAntigravityJsonValidation(jsonText, status = 200) {
  try {
    const payload = JSON.parse(String(jsonText ?? ""));
    const classifiedStatus = payload?.error?.code ?? payload?.error?.status ?? payload?.status ?? status;
    return classifyAntigravityValidation({ status: classifiedStatus, payload, source: "chat" });
  } catch {
    return null;
  }
}

/**
 * Read a bounded JSON RPC response before it crosses generic stream handling.
 * Unlike SSE, a JSON body has no frame boundary, so all chunks are retained
 * until EOF and then classified as one response.
 */
export async function readBoundedAntigravityJson({ reader, initialChunk }) {
  const chunks = [initialChunk];
  let totalBytes = initialChunk.byteLength;
  if (totalBytes > MAX_SSE_VALIDATION_FRAME_BYTES) return { exceeded: true, text: null };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_SSE_VALIDATION_FRAME_BYTES) return { exceeded: true, text: null };
    chunks.push(value);
  }

  return {
    exceeded: false,
    text: new TextDecoder().decode(concatChunks(chunks, totalBytes)),
  };
}

export function classifyAntigravitySseOutcome(sseText, { includeTrailing = true } = {}) {
  let buffer = String(sseText ?? "");
  while (true) {
    const next = nextSseEvent(buffer);
    if (!next) break;
    if (!exceedsFrameLimit(next.event)) {
      const outcome = inspectSseEvent(next.event);
      if (outcome) return outcome;
    }
    buffer = next.rest;
  }
  if (!includeTrailing || !buffer.trim() || exceedsFrameLimit(buffer)) return null;
  return inspectSseEvent(buffer);
}

export function classifyAntigravitySseValidation(sseText, options = {}) {
  const outcome = classifyAntigravitySseOutcome(sseText, options);
  return outcome?.kind === "validation" ? outcome.validation : null;
}

/**
 * Hold only a complete, bounded SSE event before it crosses any stream sink.
 * Safe events retain their bytes. Classified Antigravity validation and generic
 * error events terminate before transforms, persistence, or clients inspect them.
 */
export function createAntigravitySseValidationGate({ reader, initialChunk, onValidationRequired, onUpstreamError }) {
  const decoder = new TextDecoder();
  let buffer = decoder.decode(initialChunk, { stream: true });
  let upstreamDone = false;

  const terminate = async (controller, message) => {
    try { await reader.cancel(); } catch {}
    try { reader.releaseLock?.(); } catch {}
    controller.error(new Error(message));
  };

  const failValidation = async (controller, validation) => {
    await onValidationRequired?.(validation);
    await terminate(controller, ANTIGRAVITY_VERIFICATION_REQUIRED_MESSAGE);
  };

  const failUpstreamError = async (controller) => {
    await onUpstreamError?.();
    await terminate(controller, ANTIGRAVITY_SAFE_ERROR_MESSAGE);
  };

  return new ReadableStream({
    async pull(controller) {
      while (true) {
        const next = nextSseEvent(buffer);
        if (next) {
          buffer = next.rest;
          if (exceedsFrameLimit(next.event)) {
            await failUpstreamError(controller);
            return;
          }
          const outcome = inspectSseEvent(next.event);
          if (outcome?.kind === "validation") {
            await failValidation(controller, outcome.validation);
            return;
          }
          if (outcome?.kind === "error") {
            await failUpstreamError(controller);
            return;
          }
          controller.enqueue(encoder.encode(next.event));
          return;
        }

        if (upstreamDone) {
          const trailing = buffer + decoder.decode();
          buffer = "";
          if (!trailing) {
            controller.close();
            return;
          }
          if (exceedsFrameLimit(trailing)) {
            await failUpstreamError(controller);
            return;
          }
          const outcome = inspectSseEvent(trailing);
          if (outcome?.kind === "validation") {
            await failValidation(controller, outcome.validation);
            return;
          }
          if (outcome?.kind === "error") {
            await failUpstreamError(controller);
            return;
          }
          controller.enqueue(encoder.encode(trailing));
          return;
        }

        if (exceedsFrameLimit(buffer)) {
          await failUpstreamError(controller);
          return;
        }
        try {
          const { done, value } = await reader.read();
          if (done) {
            upstreamDone = true;
          } else if (value) {
            buffer += decoder.decode(value, { stream: true });
          }
        } catch {
          await failUpstreamError(controller);
          return;
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export function createSseTextStream(text) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}
