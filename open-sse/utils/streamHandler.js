// Stream handler with disconnect detection - shared for all providers
import {
  STREAM_STALL_TIMEOUT_MS,
  SSE_KEEPALIVE_MS,
} from "../config/runtimeConfig.js";
import { dbg, isDebugEnabled } from "./debugLog.js";

// Get HH:MM:SS timestamp
function getTimeString() {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Create stream controller with abort and disconnect detection
 * @param {object} options
 * @param {function} options.onDisconnect - Callback when client disconnects
 * @param {object} options.log - Logger instance
 * @param {string} options.provider - Provider name
 * @param {string} options.model - Model name
 */
export function createStreamController({
  onDisconnect,
  onError,
  log,
  provider,
  model,
  reqTag = "",
} = {}) {
  const abortController = new AbortController();
  const startTime = Date.now();
  let disconnected = false;
  let abortTimeout = null;

  // Only abnormal terminations are logged; normal completion is covered by "📊 done".
  // isError uses errorLine (always shown, ignores LOG_LEVEL) so failures survive quiet levels.
  const logStream = (symbol, status, isError = false) => {
    const duration = Date.now() - startTime;
    const emit = isError ? log?.errorLine : log?.line;
    if (emit)
      emit(reqTag, symbol, `${status} · ${provider}/${model} · ${duration}ms`);
    else
      console.log(
        `[${getTimeString()}] ${symbol} ${provider}/${model} · ${status} · ${duration}ms`,
      );
  };

  return {
    signal: abortController.signal,
    startTime,

    isConnected: () => !disconnected,

    // Call when client disconnects
    handleDisconnect: (reason = "client_closed") => {
      if (disconnected) return;
      disconnected = true;

      logStream("⚡", `DISCONNECT: ${reason}`);
      dbg(
        "CTRL",
        `${provider}/${model} | disconnect=${reason} | dur=${Date.now() - startTime}ms`,
      );

      // Delay abort to allow cleanup
      abortTimeout = setTimeout(() => {
        abortController.abort();
      }, 500);

      onDisconnect?.({ reason, duration: Date.now() - startTime });
    },

    // Call when stream completes normally (no line here — "📊 done" is authoritative)
    handleComplete: () => {
      if (disconnected) return;
      disconnected = true;

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }
    },

    // Call on error
    handleError: (error) => {
      if (disconnected) return;
      disconnected = true;

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }

      if (error.name === "AbortError") {
        logStream("⚡", "ABORTED");
        return;
      }

      logStream(
        "✗",
        `ERROR: ${error.message}${error.stack ? `\n    ${error.stack}` : ""}`,
        true,
      );
      onError?.(error);
    },

    abort: () => abortController.abort(),
  };
}

/**
 * Create transform stream with disconnect detection
 * Wraps existing transform stream and adds abort capability.
 *
 * Stall detection lives in pipeWithDisconnect (tied to upstream byte
 * activity), not here — output of the transform stream may be silent
 * for long periods while raw bytes still flow (e.g. Kiro EventStream
 * binary frames buffering, Claude reasoning streams).
 */
export function createDisconnectAwareStream(
  transformStream,
  streamController,
  onAbortTerminal = null,
  {
    terminalObserver = null,
    onIncompleteStream = null,
    onTerminalFailureReady = null,
    callerSignal = null,
  } = {},
) {
  const reader = transformStream.readable.getReader();
  const writer = transformStream.writable.getWriter();
  let terminalEmitted = false;
  let incompleteHandled = false;
  let downstreamCancelled = false;
  let outputController = null;
  let outputClosed = false;
  let callerAbortHandled = false;
  let removeCallerAbortListener = null;

  // Emit a synthesized terminal payload (e.g. Responses response.failed + [DONE]) once
  const emitTerminal = (controller) => {
    if (terminalEmitted || !onAbortTerminal) return;
    terminalEmitted = true;
    try {
      const bytes = onAbortTerminal();
      if (bytes) controller.enqueue(bytes);
    } catch {
      /* best-effort terminal */
    }
  };

  const emitIncompleteTerminal = (controller) => {
    if (terminalEmitted) return;
    terminalEmitted = true;
    try {
      const bytes = terminalObserver?.buildIncompleteTerminal?.() || onAbortTerminal?.();
      if (bytes) controller.enqueue(bytes);
    } catch {
      /* best-effort terminal */
    }
  };

  const handleIncomplete = (controller, error) => {
    if (incompleteHandled) return;
    incompleteHandled = true;
    emitIncompleteTerminal(controller);
    try {
      onIncompleteStream?.(error);
    } catch {
      /* existing lifecycle errors must not hide the terminal */
    }
    streamController.handleError(error);
    terminalObserver?.release?.();
  };

  const closeOutput = (controller) => {
    if (outputClosed) return;
    outputClosed = true;
    removeCallerAbortListener?.();
    removeCallerAbortListener = null;
    controller.close();
  };

  const terminateCallerAbort = () => {
    if (callerAbortHandled) return;
    callerAbortHandled = true;
    streamController.handleDisconnect("caller_aborted");
    terminalObserver?.release?.();
    reader.cancel(callerSignal?.reason).catch(() => {});
    writer.abort(callerSignal?.reason).catch(() => {});
    if (outputController) closeOutput(outputController);
  };

  const terminateIncomplete = (error) => {
    if (
      !terminalObserver
      || downstreamCancelled
      || incompleteHandled
      || terminalObserver.sawTerminal()
      || !outputController
    ) {
      return false;
    }
    handleIncomplete(outputController, error);
    closeOutput(outputController);
    reader.cancel().catch(() => {});
    writer.abort().catch(() => {});
    return true;
  };

  onTerminalFailureReady?.(terminateIncomplete);

  return new ReadableStream({
    start(controller) {
      outputController = controller;
      if (callerSignal) {
        const onCallerAbort = () => terminateCallerAbort();
        if (callerSignal.aborted) {
          onCallerAbort();
        } else {
          callerSignal.addEventListener("abort", onCallerAbort, { once: true });
          removeCallerAbortListener = () => callerSignal.removeEventListener("abort", onCallerAbort);
        }
      }
    },

    async pull(controller) {
      if (callerAbortHandled || callerSignal?.aborted) {
        terminateCallerAbort();
        return;
      }

      if (!streamController.isConnected()) {
        if (terminalObserver && !downstreamCancelled && !terminalObserver.sawTerminal()) {
          terminateIncomplete(new Error("stream ended before terminal event"));
        } else {
          emitTerminal(controller);
          terminalObserver?.release?.();
        }
        closeOutput(controller);
        return;
      }

      try {
        const { done, value } = await reader.read();

        if (done) {
          if (terminalObserver && !terminalObserver.sawTerminal()) {
            terminateIncomplete(new Error("stream ended before terminal event"));
          } else {
            streamController.handleComplete();
            terminalObserver?.release?.();
          }
          closeOutput(controller);
          return;
        }
        terminalObserver?.observe?.(value);
        controller.enqueue(value);
      } catch (error) {
        if (callerAbortHandled || callerSignal?.aborted) {
          terminateCallerAbort();
          return;
        }
        const wasConnected = streamController.isConnected();
        // Controller already closed = downstream ended; not an upstream error, skip noisy log.
        const msg0 = error?.message || "";
        const isControllerClosed =
          msg0.includes("already closed") || msg0.includes("Invalid state");
        reader.cancel().catch(() => {});
        writer.abort().catch(() => {});

        if (terminalObserver) {
          if (terminalObserver.sawTerminal()) {
            streamController.handleComplete();
            terminalObserver.release();
            closeOutput(controller);
            return;
          }
          if (!isControllerClosed && !downstreamCancelled) {
            terminateIncomplete(error);
          } else {
            terminalObserver.release();
          }
          closeOutput(controller);
          return;
        }

        if (!isControllerClosed) streamController.handleError(error);

        // Treat network resets / socket hang up / abort as graceful close
        const msg = error?.message || "";
        const code = error?.code || error?.cause?.code || "";
        const isNetworkClose =
          error.name === "AbortError" ||
          msg.includes("aborted") ||
          msg.includes("socket hang up") ||
          msg.includes("ECONNRESET") ||
          msg.includes("ETIMEDOUT") ||
          msg.includes("EPIPE") ||
          code === "ECONNRESET" ||
          code === "ETIMEDOUT" ||
          code === "EPIPE" ||
          code === "UND_ERR_SOCKET";

        // Graceful close on network/abort, or when a structured terminal is available
        // (Responses passthrough prefers response.failed + [DONE] over a raw transport error)
        try {
          if (!wasConnected || isNetworkClose || onAbortTerminal) {
            emitTerminal(controller);
            controller.close();
          } else {
            controller.error(error);
          }
        } catch (e) {
          /* already closed or cancelled */
        }
      }
    },

    cancel(reason) {
      downstreamCancelled = true;
      removeCallerAbortListener?.();
      removeCallerAbortListener = null;
      streamController.handleDisconnect(reason || "cancelled");
      terminalObserver?.release?.();
      reader.cancel();
      writer.abort();
    },
  });
}

function normalizePipeOptions(
  onAbortTerminalOrOptions,
  stallTimeoutMs,
  ttftTimeoutMs,
  keepaliveMs,
) {
  if (
    onAbortTerminalOrOptions
    && typeof onAbortTerminalOrOptions === "object"
    && !Array.isArray(onAbortTerminalOrOptions)
  ) {
    return {
      onAbortTerminal: onAbortTerminalOrOptions.onAbortTerminal ?? null,
      stallTimeoutMs: onAbortTerminalOrOptions.stallTimeoutMs ?? STREAM_STALL_TIMEOUT_MS,
      ttftTimeoutMs: onAbortTerminalOrOptions.ttftTimeoutMs ?? 30000,
      keepaliveMs: onAbortTerminalOrOptions.keepaliveMs ?? SSE_KEEPALIVE_MS,
      terminalObserver: onAbortTerminalOrOptions.terminalObserver ?? null,
      onIncompleteStream: onAbortTerminalOrOptions.onIncompleteStream ?? null,
      callerSignal: onAbortTerminalOrOptions.callerSignal ?? null,
    };
  }

  return {
    onAbortTerminal: onAbortTerminalOrOptions ?? null,
    stallTimeoutMs,
    ttftTimeoutMs,
    keepaliveMs,
    terminalObserver: null,
    onIncompleteStream: null,
    callerSignal: null,
  };
}

/**
 * Pipe provider response through transform with disconnect detection.
 *
 * Stall watchdog tracks raw upstream byte activity, not transform output.
 * Reasoning models (Claude thinking via Kiro, etc.) can produce zero SSE
 * output for long stretches while partial EventStream frames keep arriving.
 * Measuring stall on the transform output caused false stalls and the
 * "failed to pipe response" error in Next.
 *
 * Any upstream chunk resets the timer. If no bytes arrive for
 * STREAM_STALL_TIMEOUT_MS, abort the underlying fetch via the controller.
 *
 * @param {Response} providerResponse - Response from provider
 * @param {TransformStream} transformStream - Transform stream for SSE
 * ttftTimeoutMs is a separate first-byte watchdog, decoupled from the shared
 * STREAM_FIRST_CHUNK_TIMEOUT_MS constant: combo.js and kiro.js use that
 * constant (200s) as a prefill patience budget, while TTFT is fail-fast.
 *
 * @param {object} streamController - Stream controller from createStreamController
 */
export function pipeWithDisconnect(
  providerResponse,
  transformStream,
  streamController,
  onAbortTerminalOrOptions = null,
  stallTimeoutMs = STREAM_STALL_TIMEOUT_MS,
  ttftTimeoutMs = 30000,
  keepaliveMs = SSE_KEEPALIVE_MS,
) {
  const options = normalizePipeOptions(
    onAbortTerminalOrOptions,
    stallTimeoutMs,
    ttftTimeoutMs,
    keepaliveMs,
  );
  ({ stallTimeoutMs, ttftTimeoutMs, keepaliveMs } = options);
  const { onAbortTerminal, terminalObserver, onIncompleteStream, callerSignal } = options;
  let terminateWithTerminal = null;
  let stallTimer = null;
  let firstChunkTimer = null;
  let keepaliveTimer = null;
  let chunkCount = 0;
  let totalBytes = 0;
  let lastChunkAt = Date.now();
  const t0 = Date.now();
  const tag = "STREAM";

  // TTFT watchdog: if no upstream bytes arrive within the TTFT window, abort.
  // Fires only once; cleared by the first upstream byte (or any termination).
  // Separate from the inter-chunk stall watchdog so slow-but-healthy streams
  // (e.g. reasoning models with long prefill) are never falsely aborted.
  const clearFirstChunk = () => {
    if (firstChunkTimer) {
      clearTimeout(firstChunkTimer);
      firstChunkTimer = null;
    }
  };
  const armFirstChunk = () => {
    clearFirstChunk();
    firstChunkTimer = setTimeout(() => {
      firstChunkTimer = null;
      dbg(tag, `TTFT TIMEOUT ${ttftTimeoutMs}ms | no bytes received`);
      clearKeepalive();
      wrappedController.handleError(
        new Error(`stream ttft timeout (${ttftTimeoutMs}ms)`),
      );
      streamController.abort?.();
    }, ttftTimeoutMs);
  };

  const clearStall = () => {
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  };
  // SSE keepalive: emits ping frames downstream while the provider is silent
  // (pre-TTFT). Mounted on the OUTBOUND side (after transformStream) so pings
  // never enter the translator input — upstream see PR #3457's pre-tap version.
  const clearKeepalive = () => {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
  };
  const armStall = () => {
    clearStall();
    stallTimer = setTimeout(() => {
      stallTimer = null;
      dbg(
        tag,
        `STALL TIMEOUT ${stallTimeoutMs}ms | chunks=${chunkCount} | bytes=${totalBytes} | sinceLast=${Date.now() - lastChunkAt}ms`,
      );
      wrappedController.handleError(new Error("stream stall timeout"));
      streamController.abort?.();
    }, stallTimeoutMs);
  };

  // Wrap controller so every termination path clears both timers.
  // Without this, abort/cancel/downstream-error paths leave the timers armed
  // and a stale abort could fire after the request has already ended.
  const wrappedController = {
    signal: streamController.signal,
    startTime: streamController.startTime,
    isConnected: () => streamController.isConnected(),
    handleComplete: () => {
      dbg(
        tag,
        `complete | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`,
      );
      clearFirstChunk();
      clearStall();
      clearKeepalive();
      streamController.handleComplete();
    },
    handleError: (e) => {
      dbg(
        tag,
        `error: ${e?.message} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`,
      );
      clearFirstChunk();
      clearStall();
      clearKeepalive();
      if (terminalObserver && terminateWithTerminal?.(e)) return;
      streamController.handleError(e);
    },
    handleDisconnect: (r) => {
      dbg(
        tag,
        `disconnect: ${r} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`,
      );
      clearFirstChunk();
      clearStall();
      clearKeepalive();
      streamController.handleDisconnect(r);
    },
    abort: () => {
      clearFirstChunk();
      clearStall();
      clearKeepalive();
      streamController.abort();
    },
  };

  armFirstChunk();
  armStall();
  dbg(
    tag,
    `pipe start | ttftTimeout=${ttftTimeoutMs}ms | stallTimeout=${stallTimeoutMs}ms | keepalive=${keepaliveMs}ms`,
  );

  const upstreamTap = new TransformStream({
    transform(chunk, controller) {
      chunkCount++;
      const sz = chunk?.byteLength || chunk?.length || 0;
      totalBytes += sz;
      const now = Date.now();
      const gap = now - lastChunkAt;
      lastChunkAt = now;
      if (
        isDebugEnabled &&
        (chunkCount <= 5 || chunkCount % 20 === 0 || gap > 5000)
      ) {
        dbg(
          tag,
          `chunk #${chunkCount} | size=${sz}B | gap=${gap}ms | total=${totalBytes}B`,
        );
      }
      clearFirstChunk(); // first byte received — TTFT watchdog satisfied
      armStall();
      controller.enqueue(chunk);
    },
    flush() {
      dbg(
        tag,
        `upstream EOF | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`,
      );
      clearStall();
      clearKeepalive();
    },
  });

  const transformedBody = providerResponse.body
    .pipeThrough(upstreamTap)
    .pipeThrough(transformStream)
    .pipeThrough(
      new TransformStream({
        start(controller) {
          if (keepaliveMs > 0) {
            keepaliveTimer = setInterval(() => {
              if (chunkCount === 0 && streamController.isConnected()) {
                dbg(tag, `keepalive ping sent (silence=${Date.now() - t0}ms)`);
                try {
                  controller.enqueue(
                    new TextEncoder().encode("event: ping\ndata: {}\n\n"),
                  );
                } catch {
                  clearKeepalive();
                }
              } else {
                clearKeepalive();
              }
            }, keepaliveMs);
          }
        },
        cancel() {
          clearKeepalive();
        },
      }),
    );

  return createDisconnectAwareStream(
    {
      readable: transformedBody,
      writable: { getWriter: () => ({ abort: () => Promise.resolve() }) },
    },
    wrappedController,
    onAbortTerminal,
    {
      terminalObserver,
      onIncompleteStream,
      callerSignal,
      onTerminalFailureReady: (terminate) => {
        terminateWithTerminal = terminate;
      },
    },
  );
}
