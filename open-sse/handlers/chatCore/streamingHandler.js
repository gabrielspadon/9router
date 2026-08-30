import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger } from "../../utils/stream.js";
import { pipeWithDisconnect } from "../../utils/streamHandler.js";
import { PROVIDERS } from "../../config/providers.js";
import { STREAM_STALL_TIMEOUT_MS } from "../../config/runtimeConfig.js";
import { buildAbortedResponsesTerminalBytes } from "../../utils/responsesStreamHelpers.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { hasValidUsage, estimateUsage } from "../../utils/usageTracking.js";
import { saveRequestDetail } from "@/lib/usageDb.js";
import { SSE_HEADERS_CORS as SSE_HEADERS } from "../../utils/sseConstants.js";
import { classifyAntigravitySseValidation, createAntigravitySseValidationGate } from "./antigravitySseValidation.js";

// Codex returns Responses API SSE → which client format to translate INTO, by request sourceFormat.
// Gemini-family all map to ANTIGRAVITY decoder; unknown sources fall back to OPENAI.
const CODEX_SOURCE_TO_TARGET = {
  [FORMATS.OPENAI_RESPONSES]: FORMATS.OPENAI_RESPONSES,
  [FORMATS.CLAUDE]: FORMATS.CLAUDE,
  [FORMATS.ANTIGRAVITY]: FORMATS.ANTIGRAVITY,
  [FORMATS.GEMINI]: FORMATS.ANTIGRAVITY,
  [FORMATS.GEMINI_CLI]: FORMATS.ANTIGRAVITY,
};
/**
 * Determine which SSE transform stream to use based on provider/format.
 */
function buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, customToolNames, model, connectionId, body, onStreamComplete, apiKey, streamState }) {
  const isDroidCLI = userAgent?.toLowerCase().includes("droid") || userAgent?.toLowerCase().includes("codex-cli");
  // Responses-API providers (e.g. codex) emit Responses SSE → translate into client format
  const isResponsesProvider = PROVIDERS[provider]?.format === FORMATS.OPENAI_RESPONSES;
  const needsCodexTranslation = isResponsesProvider && targetFormat === FORMATS.OPENAI_RESPONSES && !isDroidCLI;

  if (needsCodexTranslation) {
    const codexTarget = CODEX_SOURCE_TO_TARGET[sourceFormat] || FORMATS.OPENAI;
    return createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, codexTarget, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, customToolNames, streamState);
  }

  if (needsTranslation(targetFormat, sourceFormat)) {
    return createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, customToolNames, streamState);
  }

  return createPassthroughStreamWithLogger(provider, reqLogger, model, connectionId, body, onStreamComplete, apiKey, streamState);
}

/**
 * Handle streaming response — pipe provider SSE through transform stream to client.
 */
export async function handleStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, userAgent, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, verificationContext, onValidationRequired, reqLogger, toolNameMap, customToolNames, streamController, onStreamComplete, streamDetailId, streamState, pxpipe, reqTag, log }) {
  // When upstream returns HTML/text instead of SSE (e.g. Cloudflare 5xx error
  // page), piping it through the SSE transform stream causes Next.js
  // "failed to pipe response" and crashes the chat router. Read the body,
  // pull a short human-readable message from the <title>, sanitize it, and
  // return a clean JSON error instead. The message is stripped of HTML tags
  // and clamped so untrusted upstream text never reaches the client verbatim
  // (the UI may render error.message as HTML).
  const upstreamContentType = (providerResponse.headers?.get?.('content-type') || '').toLowerCase();
  if (
    upstreamContentType &&
    !upstreamContentType.includes('text/event-stream') &&
    !upstreamContentType.includes('application/json') &&
    !upstreamContentType.includes('application/x-ndjson') &&
    !upstreamContentType.includes('application/stream+json')
  ) {
    const bodyText = await providerResponse.text().catch(() => '');
    const titleMatch = bodyText.match(/<title>([^<]+)<\/title>/i);
    const sanitizedTitle = (titleMatch?.[1] || '').replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
    const shortMsg = sanitizedTitle
      || (bodyText.length < 200 ? bodyText.replace(/<[^>]*>/g, '').trim().slice(0, 160) : `Upstream returned non-SSE response (${upstreamContentType})`);
    const status = providerResponse.status || 502;
    if (log?.errorLine) log.errorLine(reqTag, "✗", `BLOCKED ${status} · ${provider}/${model} · non-SSE (${upstreamContentType})\n    ${shortMsg}`);
    else console.warn(`[STREAM] ${provider} | ${model} | blocked pipe: ${shortMsg} [${status}]`);
    streamController?.handleError?.(new Error(`upstream non-SSE: ${status}`));
    return {
      success: false,
      status,
      error: shortMsg,
      response: new Response(JSON.stringify({ error: { message: `[${status}]: ${shortMsg}` } }), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      }),
    };
  }

  // First-valid-event gate: buffer the first chunk from upstream before confirming success.
  // This prevents empty streams (0 bytes) or immediate error objects disguised as 200 OK
  // from falsely clearing account errors or committing an unusable stream to the client.
  if (!providerResponse.body) {
    const status = 502;
    const shortMsg = "Upstream returned no response body";
    if (log?.errorLine) log.errorLine(reqTag, "✗", `BLOCKED ${status} · ${provider}/${model} · ${shortMsg}`);
    streamController?.handleError?.(new Error(shortMsg));
    return {
      success: false,
      status,
      error: shortMsg,
      response: new Response(JSON.stringify({ error: { message: `[${status}]: ${shortMsg}` } }), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      }),
    };
  }

  let reader = null;
  let firstChunk = null;
  try {
    reader = providerResponse.body.getReader();
    const { done, value } = await reader.read();
    if (done || !value || value.length === 0) {
      try { reader.releaseLock?.(); } catch {}
      const status = 502;
      const shortMsg = "Upstream stream ended before a valid event (empty stream)";
      if (log?.errorLine) log.errorLine(reqTag, "✗", `BLOCKED ${status} · ${provider}/${model} · ${shortMsg}`);
      streamController?.handleError?.(new Error(shortMsg));
      return {
        success: false,
        status,
        error: shortMsg,
        response: new Response(JSON.stringify({ error: { message: `[${status}]: ${shortMsg}` } }), {
          status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        }),
      };
    }
    firstChunk = value;
  } catch (readErr) {
    const status = 502;
    const shortMsg = `Upstream stream read error: ${readErr?.message || readErr}`;
    if (log?.errorLine) log.errorLine(reqTag, "✗", `BLOCKED ${status} · ${provider}/${model} · ${shortMsg}`);
    streamController?.handleError?.(readErr);
    return {
      success: false,
      status,
      error: shortMsg,
      response: new Response(JSON.stringify({ error: { message: `[${status}]: ${shortMsg}` } }), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      }),
    };
  }

  const reportValidation = async (validation) => {
    try {
      await onValidationRequired?.({
        validation,
        observationId: verificationContext?.observationId,
      });
    } catch {
      log?.warn?.("VERIFICATION", `validation callback failed for ${String(connectionId).slice(0, 8)}`);
    }
  };
  const initialValidation = provider === "antigravity"
    ? classifyAntigravitySseValidation(new TextDecoder().decode(firstChunk), { includeTrailing: false })
    : null;
  if (initialValidation) {
    await reportValidation(initialValidation);
    try { await reader.cancel(); } catch {}
    try { reader.releaseLock?.(); } catch {}
    const status = 403;
    const message = "Antigravity account verification required";
    streamController?.handleError?.(new Error(message));
    return {
      success: false,
      status,
      error: message,
      response: new Response(JSON.stringify({ error: { message: `[${status}]: ${message}` } }), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      }),
    };
  }

  // Check if first chunk contains a structured JSON error object returned as 200 OK
  if (firstChunk) {
    const chunkStr = new TextDecoder().decode(firstChunk);
    const trimmed = chunkStr.trim();
    if (trimmed.startsWith("{") && (trimmed.includes('"error"') || trimmed.includes('"error_code"') || trimmed.includes('"detail"'))) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.error || parsed.error_code || (parsed.detail && !parsed.choices && !parsed.delta)) {
          const errMsg = typeof parsed.error === "string"
            ? parsed.error
            : parsed.error?.message || parsed.error_msg || parsed.detail || JSON.stringify(parsed);
          const safeErrMsg = provider === "antigravity"
            ? "Antigravity upstream request failed"
            : errMsg;
          const rawStatus = parsed.error?.status || parsed.status || 502;
          const status = typeof rawStatus === "number" && rawStatus >= 400 && rawStatus < 600 ? rawStatus : 502;
          if (log?.errorLine) log.errorLine(reqTag, "✗", `ERROR ${status} · ${provider}/${model} · ${safeErrMsg}`);
          streamController?.handleError?.(new Error(safeErrMsg));
          return {
            success: false,
            status,
            error: safeErrMsg,
            response: new Response(JSON.stringify({ error: { message: `[${status}]: ${safeErrMsg}` } }), {
              status,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            }),
          };
        }
      } catch {
        // Not a pure JSON error object, treat as valid streaming content
      }
    }
  }

  // Non-Antigravity streams can clear account health after their first valid
  // event. Antigravity must wait for terminal completion because a later SSE
  // frame can still be a validation challenge.
  if (onRequestSuccess && provider !== "antigravity") {
    Promise.resolve()
      .then(onRequestSuccess)
      .catch(err => {
        console.error("[ChatCore] onRequestSuccess failed:", err?.message || err);
      });
  }

  // Reconstruct the upstream stream with the buffered first chunk prepended.
  // Antigravity frames are parsed before every downstream sink, not only once.
  let responseBodyStream = providerResponse.body;
  if (reader && firstChunk) {
    if (provider === "antigravity") {
      responseBodyStream = createAntigravitySseValidationGate({
        reader,
        initialChunk: firstChunk,
        onValidationRequired: async (validation) => {
          await reportValidation(validation);
          streamController?.handleError?.(new Error("Antigravity account verification required"));
        },
      });
    } else {
      let yieldedFirst = false;
      responseBodyStream = new ReadableStream({
        async pull(controller) {
          if (!yieldedFirst) {
            yieldedFirst = true;
            controller.enqueue(firstChunk);
            return;
          }
          try {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              return;
            }
            controller.enqueue(value);
          } catch (err) {
            controller.error(err);
          }
        },
        cancel(reason) {
          return reader.cancel(reason);
        }
      });
    }
  }

  let antigravityRequestSuccessNotified = false;
  const onStreamCompleteAtTerminal = (...args) => {
    onStreamComplete?.(...args);
    if (provider !== "antigravity" || antigravityRequestSuccessNotified || typeof onRequestSuccess !== "function") return;
    const [contentObj, usage, , { aborted = false } = {}] = args;
    if (aborted || !(contentObj?.content?.trim?.() || contentObj?.thinking?.trim?.() || hasOutputTokens(usage))) return;
    antigravityRequestSuccessNotified = true;
    Promise.resolve()
      .then(onRequestSuccess)
      .catch(err => {
        console.error("[ChatCore] onRequestSuccess failed:", err?.message || err);
      });
  };

  const transformStream = buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, customToolNames, model, connectionId, body, onStreamComplete: onStreamCompleteAtTerminal, apiKey, streamState });

  // Responses passthrough: synthesize response.failed + [DONE] if the stream aborts/stalls before a terminal event
  const isResponsesPassthrough = sourceFormat === FORMATS.OPENAI_RESPONSES && targetFormat === FORMATS.OPENAI_RESPONSES;
  const onAbortTerminal = isResponsesPassthrough ? buildAbortedResponsesTerminalBytes : null;
  const stallTimeoutMs = PROVIDERS[provider]?.stallTimeoutMs || STREAM_STALL_TIMEOUT_MS;
  const wrappedResponse = {
    ...providerResponse,
    body: responseBodyStream,
    headers: providerResponse.headers,
  };
  const transformedBody = pipeWithDisconnect(wrappedResponse, transformStream, streamController, onAbortTerminal, stallTimeoutMs);

  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId,
    latency: { ttft: 0, total: Date.now() - requestStartTime },
    tokens: { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
    providerResponse: "[Streaming - raw response not captured]",
    response: { content: "[Streaming in progress...]", thinking: null, type: "streaming" },
    pxpipe,
    status: "success"
  }, { id: streamDetailId })).catch(err => {
    console.error("[RequestDetail] Failed to save streaming request:", err.message);
  });

  return {
    success: true,
    response: new Response(transformedBody, { headers: SSE_HEADERS })
  };
}

/**
 * Whether a completed stream actually produced anything: text, thinking, or
 * output tokens (covers tool-call-only turns, which have no text/thinking but
 * do spend completion tokens). Checking completion/output tokens specifically
 * — not just "any usage field" — avoids false-flagging a real tool-call
 * response as empty just because prompt tokens alone are non-zero.
 */
function hasOutputTokens(usage) {
  if (!usage || typeof usage !== "object") return false;
  const n = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount ?? 0);
  return n > 0;
}

function notifyTerminalVerificationSuccess(callback, connectionId, log) {
  if (typeof callback !== "function") return;
  try {
    Promise.resolve(callback()).catch(() => {
      log?.warn?.("VERIFICATION", `success callback failed for ${String(connectionId).slice(0, 8)}`);
    });
  } catch {
    log?.warn?.("VERIFICATION", `success callback failed for ${String(connectionId).slice(0, 8)}`);
  }
}

/**
 * Build onStreamComplete callback for streaming usage tracking.
 * @param {Function} [onEmptyStream] - called (no args) once, after the stream
 *   finishes, if it produced no text/thinking/output tokens at all. The
 *   response has already been sent to the client by this point (streaming
 *   commits to `success: true` before the body is known), so this can't
 *   un-send it — it exists so the caller can lock the account/model out of
 *   rotation for the *next* request (see chat.js), which is what actually
 *   gets a retried request routed to a different backend.
 */
export function buildOnStreamComplete({ provider, model, connectionId, apiKey, requestStartTime, body, stream, finalBody, translatedBody, clientRawRequest, pxpipe, reqTag, log, onEmptyStream, sourceFormat, notifyTerminalVerificationSuccess: notifyTerminal }) {
  const streamDetailId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  // One-shot finalization guard shared by onStreamComplete (flush/cancel paths)
  // and onStreamAbandoned (upstream error path): whoever fires first wins, so a
  // disconnect, a stall and a late EOF can never write two rows.
  let completed = false;

  // Mutable state the SSE transform stream populates on every chunk via syncState()
  const streamState = { usage: null, content: "", thinking: "", ttftAt: null };

  const onStreamComplete = (contentObj, usage, ttftAt, { aborted = false } = {}) => {
    if (completed) return;
    completed = true;
    const latency = {
      ttft: ttftAt ? ttftAt - requestStartTime : Date.now() - requestStartTime,
      total: Date.now() - requestStartTime
    };
    const safeContent =
      contentObj?.content || (aborted ? "[Aborted streaming response]" : "[Empty streaming response]");
    const safeThinking = contentObj?.thinking || null;

    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency,
      tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      providerResponse: safeContent,
      response: { content: safeContent, thinking: safeThinking, type: "streaming" },
      pxpipe,
      status: aborted ? "aborted" : "success"
    }, { id: streamDetailId })).catch(err => {
      console.error("[RequestDetail] Failed to update streaming content:", err.message);
    });

    // Persist stream usage to DB (no console line; the "📊 done" line below is authoritative)
    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, requestedModel: clientRawRequest?.body?.model, label: aborted ? "STREAM USAGE (aborted)" : "STREAM USAGE", silent: true });
    if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency }));

    if (onEmptyStream && !contentObj?.content?.trim?.() && !contentObj?.thinking?.trim?.() && !hasOutputTokens(usage)) {
      if (log?.warn) log.warn("CHATCORE", `${provider}/${model} stream completed with no content/thinking/output tokens — locking for next request`);
      try { onEmptyStream(); } catch (e) { console.error("[Stream] onEmptyStream failed:", e?.message || e); }
    }

    if (
      provider === "antigravity"
      && !aborted
      && (contentObj?.content?.trim?.() || contentObj?.thinking?.trim?.() || hasOutputTokens(usage))
    ) {
      notifyTerminalVerificationSuccess(notifyTerminal, connectionId, log);
    }
  };

  // Finalize the placeholder row when the stream ends without flush() or
  // cancel() ever running: an upstream error (ECONNRESET, stall timeout) errors
  // the composite readable before the client sees it, which suppresses the
  // transform's cancel() per the Streams spec. Recovers the partial usage the
  // transform stream accumulated in streamState, then marks the row cancelled.
  const onStreamAbandoned = (reason) => {
    if (completed) return;
    completed = true;
    const detail = `[Streaming interrupted: ${reason || "unknown"}]`;

    let partialUsage = streamState.usage;
    if (!hasValidUsage(partialUsage) && streamState.content) {
      partialUsage = estimateUsage(body, streamState.content.length, sourceFormat || FORMATS.OPENAI);
    }
    const tokens = partialUsage
      ? { ...partialUsage, completion_tokens: partialUsage.completion_tokens ?? partialUsage.output_tokens ?? 0 }
      : { prompt_tokens: 0, completion_tokens: 0 };

    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency: { ttft: streamState.ttftAt ? streamState.ttftAt - requestStartTime : 0, total: Date.now() - requestStartTime },
      tokens,
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      providerResponse: detail,
      response: { content: detail, thinking: null, type: "streaming" },
      pxpipe,
      status: "cancelled"
    }, { id: streamDetailId })).catch(err => {
      console.error("[RequestDetail] Failed to finalize interrupted stream:", err.message);
    });

    if (hasValidUsage(tokens)) {
      saveUsageStats({ provider, model, tokens, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, label: "STREAM USAGE (interrupted)", silent: true });
    }
    if (log?.line) log.line(reqTag, "✗", `INTERRUPTED ${reason || "unknown"}`);
  };

  return { onStreamComplete, onStreamAbandoned, streamDetailId, streamState };
}
