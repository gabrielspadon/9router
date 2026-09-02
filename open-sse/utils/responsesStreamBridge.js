import { SSE_HEADERS_CORS } from "./sseConstants.js";
import { buildEarlyResponsesFailureTerminalBytes } from "./responsesStreamHelpers.js";

const encoder = new TextEncoder();
const CONNECTED = encoder.encode(": connected\n\n");

/**
 * Open the client-facing Responses stream before account selection and upstream
 * connection settle. Successful SSE bytes are forwarded without parsing.
 */
export function createDeferredResponsesResponse(run, { signal: parentSignal } = {}) {
  const workController = new AbortController();
  let upstreamReader = null;
  let ready;
  let resolveReady;
  let readyState = { kind: "pending" };
  let closed = false;
  let controller;
  let parentAbort = null;

  const settleReady = (state) => {
    if (readyState.kind !== "pending") return;
    readyState = state;
    resolveReady(state);
  };

  const finish = () => {
    if (closed) return;
    closed = true;
    parentSignal?.removeEventListener("abort", parentAbort);
    try { controller.close(); } catch { /* downstream already closed */ }
  };

  const cancelWork = (reason) => {
    if (closed) return;
    closed = true;
    parentSignal?.removeEventListener("abort", parentAbort);
    if (!workController.signal.aborted) workController.abort(reason);
    upstreamReader?.cancel(reason).catch(() => {});
    settleReady({ kind: "closed" });
  };

  const stream = new ReadableStream({
    start(streamController) {
      controller = streamController;
      ready = new Promise((resolve) => {
        resolveReady = resolve;
      });

      if (parentSignal?.aborted) {
        cancelWork(parentSignal.reason);
        streamController.close();
        return;
      }
      parentAbort = () => {
        cancelWork(parentSignal.reason);
        try { streamController.close(); } catch { /* downstream already closed */ }
      };
      parentSignal?.addEventListener("abort", parentAbort, { once: true });

      streamController.enqueue(CONNECTED);
      Promise.resolve()
        .then(() => run(workController.signal))
        .then((response) => {
          if (closed) return response?.body?.cancel().catch(() => {});
          const contentType = response instanceof Response
            ? (response.headers.get("content-type") || "").toLowerCase()
            : "";
          if (!contentType.includes("text/event-stream") || !response.body) {
            settleReady({ kind: "terminal", bytes: buildEarlyResponsesFailureTerminalBytes() });
            return;
          }
          upstreamReader = response.body.getReader();
          settleReady({ kind: "stream" });
        })
        .catch(() => {
          if (closed) return;
          settleReady({ kind: "terminal", bytes: buildEarlyResponsesFailureTerminalBytes() });
        });
    },

    async pull() {
      const state = await ready;
      if (closed || state.kind === "closed") return;
      if (state.kind === "terminal") {
        controller.enqueue(state.bytes);
        finish();
        return;
      }
      try {
        const { value, done } = await upstreamReader.read();
        if (done) finish();
        else controller.enqueue(value);
      } catch {
        controller.enqueue(buildEarlyResponsesFailureTerminalBytes());
        finish();
      }
    },

    cancel(reason) {
      cancelWork(reason || "client closed");
    },
  });

  return new Response(stream, { headers: SSE_HEADERS_CORS });
}
