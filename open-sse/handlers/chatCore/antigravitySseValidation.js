import { classifyAntigravityValidation } from "../../services/antigravityValidation.js";

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

function classifySseEvent(event) {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  if (data.length === 0) return null;
  try {
    const payload = JSON.parse(data.join("\n"));
    const status = payload?.error?.code ?? payload?.error?.status ?? payload?.status;
    return classifyAntigravityValidation({ status, payload, source: "chat" });
  } catch {
    return null;
  }
}

function exceedsFrameLimit(text) {
  return encoder.encode(text).byteLength > MAX_SSE_VALIDATION_FRAME_BYTES;
}

export function classifyAntigravitySseValidation(sseText, { includeTrailing = true } = {}) {
  let buffer = String(sseText ?? "");
  while (true) {
    const next = nextSseEvent(buffer);
    if (!next) break;
    if (!exceedsFrameLimit(next.event)) {
      const validation = classifySseEvent(next.event);
      if (validation) return validation;
    }
    buffer = next.rest;
  }
  if (!includeTrailing || !buffer.trim() || exceedsFrameLimit(buffer)) return null;
  return classifySseEvent(buffer);
}

/**
 * Hold only a complete, bounded SSE event before it crosses any stream sink.
 * Safe events retain their bytes. A classified Antigravity validation event
 * invokes the trusted callback and terminates before transforms can inspect it.
 */
export function createAntigravitySseValidationGate({ reader, initialChunk, onValidationRequired }) {
  const decoder = new TextDecoder();
  let buffer = decoder.decode(initialChunk, { stream: true });
  let upstreamDone = false;

  const failValidation = async (controller, validation) => {
    await onValidationRequired?.(validation);
    try { await reader.cancel(); } catch {}
    try { reader.releaseLock?.(); } catch {}
    controller.error(new Error("Antigravity account verification required"));
  };

  return new ReadableStream({
    async pull(controller) {
      while (true) {
        const next = nextSseEvent(buffer);
        if (next) {
          buffer = next.rest;
          if (exceedsFrameLimit(next.event)) {
            try { await reader.cancel(); } catch {}
            try { reader.releaseLock?.(); } catch {}
            controller.error(new Error("Antigravity SSE frame exceeded safe inspection limit"));
            return;
          }
          const validation = classifySseEvent(next.event);
          if (validation) {
            await failValidation(controller, validation);
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
            controller.error(new Error("Antigravity SSE frame exceeded safe inspection limit"));
            return;
          }
          const validation = classifySseEvent(trailing);
          if (validation) {
            await failValidation(controller, validation);
            return;
          }
          controller.enqueue(encoder.encode(trailing));
          return;
        }

        if (exceedsFrameLimit(buffer)) {
          try { await reader.cancel(); } catch {}
          try { reader.releaseLock?.(); } catch {}
          controller.error(new Error("Antigravity SSE frame exceeded safe inspection limit"));
          return;
        }
        try {
          const { done, value } = await reader.read();
          if (done) {
            upstreamDone = true;
          } else if (value) {
            buffer += decoder.decode(value, { stream: true });
          }
        } catch (error) {
          controller.error(error);
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
