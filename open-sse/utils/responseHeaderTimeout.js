import {
  isValidConnectTimeoutMs,
  resolveConnectTimeoutMs,
} from "../config/connectTimeout.js";

export class ConnectTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Upstream response headers exceeded ${timeoutMs}ms`);
    this.name = "ConnectTimeoutError";
    this.code = "UPSTREAM_CONNECT_TIMEOUT";
    this.timeoutMs = timeoutMs;
  }
}

export function isConnectTimeoutError(error) {
  return error?.name === "ConnectTimeoutError"
    && error?.code === "UPSTREAM_CONNECT_TIMEOUT";
}

export function createResponseHeaderTimeout({ timeoutMs, signal: callerSignal } = {}) {
  if (!isValidConnectTimeoutMs(timeoutMs)) {
    throw new TypeError("timeoutMs must be a finite integer from 1000 through 120000");
  }

  const timeoutController = new AbortController();
  let source = callerSignal?.aborted ? "caller" : null;
  let cleared = false;
  let timeoutError = null;

  const observeCallerAbort = () => {
    if (source !== null) return;
    source = "caller";
  };

  if (!callerSignal?.aborted) {
    callerSignal?.addEventListener("abort", observeCallerAbort, { once: true });
  }

  const timer = setTimeout(() => {
    if (source !== null) return;
    source = "timeout";
    timeoutError = new ConnectTimeoutError(timeoutMs);
    timeoutController.abort(timeoutError);
  }, timeoutMs);

  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeoutController.signal])
    : timeoutController.signal;

  const clear = () => {
    if (cleared) return;
    cleared = true;
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", observeCallerAbort);
  };

  return {
    signal,
    clear,
    classify(error) {
      return source === "timeout" ? timeoutError : error;
    },
  };
}

export function createExecutorResponseHeaderTimeout({
  connectTimeout,
  registryTimeout,
  envTimeout,
  signal,
} = {}) {
  const timeoutMs = resolveConnectTimeoutMs({
    providerOverride: connectTimeout?.providerOverride,
    registryTimeout,
    globalTimeout: connectTimeout?.globalTimeout,
    envTimeout,
  });
  return {
    ...createResponseHeaderTimeout({ timeoutMs, signal }),
    timeoutMs,
  };
}
