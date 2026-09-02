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
  try {
    return JSON.parse(text);
  } catch (error) {
    // An upstream that answers with an HTML error page, a proxy's plain-text
    // refusal, or an empty body made this throw "Unexpected token < in JSON at
    // position 0", and that SyntaxError was what reached the operator: it names
    // the parser, never the upstream, so a gateway timeout and a provider
    // outage looked identical and neither looked like what it was (#1930).
    //
    // The body IS the diagnosis, so carry it. Truncated because an HTML error
    // page can be tens of kilobytes and the first line is the part that
    // identifies who produced it.
    const preview = String(text ?? "").trim().slice(0, 300);
    const detail = preview
      ? `Upstream returned a non-JSON body: ${preview}`
      : "Upstream returned an empty body where JSON was expected";
    const wrapped = new Error(detail);
    wrapped.cause = error;
    wrapped.responseText = text;
    throw wrapped;
  }
}
