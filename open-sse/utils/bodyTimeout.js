import { RESPONSE_BODY_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { CallerAbortError } from "./error.js";

export class BodyReadTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Upstream response body timed out after ${timeoutMs}ms`);
    this.name = "BodyReadTimeoutError";
    this.code = "UPSTREAM_RESPONSE_BODY_TIMEOUT";
    this.timeoutMs = timeoutMs;
  }
}

export function isBodyReadTimeoutError(error) {
  return error?.name === "BodyReadTimeoutError"
    || error?.code === "UPSTREAM_RESPONSE_BODY_TIMEOUT";
}

function requirePositiveTimeout(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Response body timeout must be a positive integer");
  }
  return timeoutMs;
}

export async function consumeResponseBodyWithDeadline({
  body,
  callerSignal,
  timeoutMs = RESPONSE_BODY_TIMEOUT_MS,
  consume,
}) {
  if (callerSignal?.aborted) {
    throw new CallerAbortError(callerSignal.reason);
  }
  if (!body || typeof body.getReader !== "function") {
    throw new TypeError("Upstream response body is not readable");
  }
  if (typeof consume !== "function") {
    throw new TypeError("Response body consumer must be a function");
  }
  requirePositiveTimeout(timeoutMs);

  const reader = body.getReader();
  let terminalError = null;
  let timer = null;
  let released = false;
  const cancelReader = (error) => {
    if (terminalError) return;
    terminalError = error;
    try {
      Promise.resolve(reader.cancel(error)).catch(() => {});
    } catch { /* cancellation is best effort once the first cause is fixed */ }
  };
  const onCallerAbort = () => cancelReader(new CallerAbortError(callerSignal.reason));

  try {
    if (callerSignal) {
      callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    }
    timer = setTimeout(() => cancelReader(new BodyReadTimeoutError(timeoutMs)), timeoutMs);
    const result = await consume(reader);
    if (terminalError) throw terminalError;
    return result;
  } catch (error) {
    if (terminalError) throw terminalError;
    throw error;
  } finally {
    if (timer !== null) clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
    if (!released) {
      released = true;
      reader.releaseLock();
    }
  }
}

export async function readResponseTextWithDeadline(options) {
  return consumeResponseBodyWithDeadline({
    ...options,
    consume: async (reader) => {
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    },
  });
}

export async function readResponseJsonWithDeadline(options) {
  const text = await readResponseTextWithDeadline(options);
  return JSON.parse(text);
}
