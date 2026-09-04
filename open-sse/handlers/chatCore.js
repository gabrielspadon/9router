import { detectFormat } from "../services/provider.js";
import { resolveUpstreamRoute } from "./chatCore/upstreamRoute.js";
import { translateRequest } from "../translator/index.js";
import {
  applyThinking,
  extractThinking,
  stripThinkingSuffix,
} from "../translator/concerns/thinkingUnified.js";
import { FORMATS } from "../translator/formats.js";
import {
  normalizeClaudePassthrough,
  anchorClaudeCache,
} from "../translator/formats/claude.js";
import { createStreamController } from "../utils/streamHandler.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { createRequestLogger } from "../utils/requestLogger.js";
import {
  getModelStrip,
  getModelUpstreamId,
  getModelType,
  PROVIDER_ID_TO_ALIAS,
} from "../config/providerModels.js";
import { PROVIDERS } from "../config/providers.js";
import {
  createCallerAbortResult,
  createErrorResult,
  parseUpstreamError,
  formatProviderError,
  isCallerAbortError,
} from "../utils/error.js";
import { ANTIGRAVITY_SAFE_ERROR_MESSAGE } from "../services/antigravityValidation.js";
import { HTTP_STATUS, TOKEN_SAVER_HEADER } from "../config/runtimeConfig.js";
import { isBodyReadTimeoutError } from "../utils/bodyTimeout.js";
import { handleBypassRequest } from "../utils/bypassHandler.js";
import {
  trackPendingRequest,
  appendRequestLog,
  saveRequestDetail,
  trackActiveSession,
} from "@/lib/usageDb.js";
import { nextRid } from "@/shared/observability/decide.js";
import { getExecutor } from "../executors/index.js";
import { supportsGrokCliReasoningEffort } from "../config/grokCli.js";
import {
  buildRequestDetail,
  extractRequestConfig,
} from "./chatCore/requestDetail.js";
import { handleForcedSSEToJson } from "./chatCore/sseToJsonHandler.js";
import { clientRequestedStreaming as requestedStreaming } from "./chatCore/streamMode.js";
import { handleNonStreamingResponse } from "./chatCore/nonStreamingHandler.js";
import {
  handleStreamingResponse,
  buildOnStreamComplete,
} from "./chatCore/streamingHandler.js";
import {
  detectClientTool,
  isNativePassthrough,
} from "../utils/clientDetector.js";
import { dedupeTools } from "../utils/toolDeduper.js";
import { toolFilter } from "../utils/toolFilter.js";
import { disclosureTools } from "../utils/toolDisclosure.js";
import { injectCaveman } from "../rtk/caveman.js";
import { injectPonytail } from "../rtk/ponytail.js";
import { compressMessages, formatRtkLog } from "../rtk/index.js";
import { redactOutbound } from "../utils/privacyFilter.js";
import { redactProxyUrlForLog } from "../utils/proxyFetch.js";
import {
  compressWithHeadroom,
  formatHeadroomLog,
  formatHeadroomSizeLog,
  isHeadroomPhantomSavings,
} from "../rtk/headroom.js";
import { compressWithPxpipe } from "../rtk/pxpipe.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { stripUnsupportedModalities } from "../translator/concerns/modality.js";
import {
  stripRejectedFields,
  addRejectedFields,
  getRejectedFields,
  extractRejectedFieldNamesFromError,
} from "../translator/concerns/adaptiveStripper.js";
import { prefetchRemoteImages } from "../translator/concerns/prefetch.js";
import { defaultClaudeToolType } from "../translator/concerns/toolCall.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { applyMemoryEnhancements } from "../services/memory/index.js";
import { isConnectTimeoutError } from "../utils/responseHeaderTimeout.js";
import { applyCodexFastMode } from "../config/codexFastMode.js";
import { projectClientModelStatus } from "../config/modelErrorClassifier.js";

// Give the compressor its own copy of the items it rewrites in place, so a
// retry on another account starts from the caller's original text rather than
// from the previous attempt's output. Only the compressible collections are
// copied, never the whole body: the body carries streams and abort signals that
// structuredClone would reject, and the rest of it is not touched by the
// compressor anyway. Falls back to leaving the body alone, which is the
// pre-existing behaviour, if the clone is refused.
function isolateCompressibleItems(body) {
  if (!body) return;
  for (const key of ["messages", "input"]) {
    if (!Array.isArray(body[key])) continue;
    try {
      body[key] = structuredClone(body[key]);
    } catch {
      // A non-cloneable item means this collection stays shared. Compression is
      // idempotent-ish rather than exact, so a shared array is a worse result,
      // not a broken one.
    }
  }
  if (body.conversationState) {
    try {
      body.conversationState = structuredClone(body.conversationState);
    } catch { /* as above */ }
  }
}

/**
 * One PROXY line per request, describing which egress the attempt uses.
 * Both branches go through redactProxyUrlForLog: the relay branch used to
 * print its URL whole while the sibling proxy branch masked its own, so a
 * relay token in a query string reached the log the proxy password never
 * did, and the proxy branch fell back to the RAW url whenever `new URL()`
 * threw (#2343).
 */
export function logProxySelection({ proxyOptions, credentials, provider, model, log }) {
  const connectionName =
    credentials?.connectionName || credentials?.connectionId || "unknown";
  const poolId =
    credentials?.providerSpecificData?.connectionProxyPoolId || "none";
  const prefix = `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId}`;

  if (proxyOptions.vercelRelayUrl) {
    log?.info?.("PROXY", `${prefix} | vercel-relay=${redactProxyUrlForLog(proxyOptions.vercelRelayUrl)}`);
  } else if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionProxyUrl) {
    log?.info?.("PROXY", `${prefix} | url=${redactProxyUrlForLog(proxyOptions.connectionProxyUrl)}`);
  }

  if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionNoProxy) {
    log?.debug?.(
      "PROXY",
      `${provider.toUpperCase()} | ${model} | conn=${connectionName} | no_proxy=${proxyOptions.connectionNoProxy}`,
    );
  }
}

/**
 * Core chat handler - shared between SSE and Worker
 * @param {object} options.body - Request body
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {string} options.sourceFormatOverride - Override detected source format (e.g. "openai-responses")
 */
/**
 * Remove translator-internal continuity fields from the outbound upstream
 * body. The Responses→Chat request translator stashes reasoning
 * `encrypted_content` on assistant messages so a later openai→responses
 * round-trip can restore the store=false continuity blob; that stash must
 * never reach an upstream provider. Chat-native proxies reject the unknown
 * assistant-message field and answer every turn with a literal "400" body
 * (observed with multi-turn Codex sessions via OpenAI-compatible nodes).
 */
export function stripContinuityFields(body, provider, model, log) {
  if (!body || !Array.isArray(body.messages)) return body;
  if (provider && model) {
    const rejected = getRejectedFields(provider, model);
    if (rejected.size) {
      log?.debug?.(
        "FIELDSTRIP",
        `preSend strip ${provider}/${model}: blocked ${[...rejected].join(", ")}`,
      );
      const stripped = stripRejectedFields(body, provider, model);
      if (stripped) body = stripped;
    }
  }
  for (const msg of body.messages) {
    if (msg && typeof msg === "object") {
      delete msg.encrypted_content;
      delete msg.reasoning_encrypted_content;
    }
  }
  return body;
}

export async function handleChatCore({
  requestId,
  body,
  modelInfo,
  credentials: rawCredentials,
  callerSignal,
  log,
  onCredentialsRefreshed,
  onRequestSuccess,
  verificationContext,
  onValidationRequired,
  onVerificationSuccess,
  onEmptyStream,
  onDisconnect,
  clientRawRequest,
  connectionId,
  userAgent,
  apiKey,
  ccFilterNaming,
  rtkEnabled,
  privacyEnabled,
  privacyTerms,
  headroomEnabled,
  headroomUrl,
  headroomCompressUserMessages,
  headroomTimeoutMs,
  cavemanEnabled,
  cavemanLevel,
  ponytailEnabled,
  ponytailLevel,
  pxpipeEnabled,
  pxpipeMinChars,
  pxpipeTimeoutMs,
  pxpipeTransform,
  onPxpipeEvent,
  onTokenSaverEvent,
  sourceFormatOverride,
  providerThinking,
  connectTimeout,
  memorySettings,
  toolDisclosure,
  codexFastMode,
}) {
  const credentials = rawCredentials
    ? {
        ...rawCredentials,
        ...(rawCredentials.providerSpecificData &&
        typeof rawCredentials.providerSpecificData === "object" &&
        !Array.isArray(rawCredentials.providerSpecificData)
          ? { providerSpecificData: { ...rawCredentials.providerSpecificData } }
          : {}),
      }
    : rawCredentials;
  const { provider, model } = modelInfo;
  const notifyTerminalVerificationSuccess =
    onVerificationSuccess && verificationContext?.challengeIdAtStart
      ? async () => {
          try {
            await onVerificationSuccess({ challengeId: verificationContext.challengeIdAtStart });
          } catch {
            log?.warn?.("VERIFICATION", `success callback failed for ${String(connectionId).slice(0, 8)}`);
          }
        }
      : null;
  const requestStartTime = Date.now();
  // Stable per-session color so all lines of one CLI conversation share a tag
  const sessionSeed = (() => {
    try {
      return resolveSessionId({
        headers: clientRawRequest?.headers,
        body,
        connectionId,
        scope: provider,
      });
    } catch {
      return connectionId || "";
    }
  })();
  const emojiTag = log?.tagForSession
    ? log.tagForSession(sessionSeed)
    : log?.nextTag
      ? log.nextTag()
      : "";
  // `reqTag` is a display prefix and nothing else -- every consumer passes it
  // straight to log.line/log.errorLine -- so putting the request id INSIDE it
  // gives all ~20 emit sites in this file and its handlers a correlation id for
  // no further plumbing. That is what makes the existing ▶ and 📊 lines joinable:
  // the emoji namespace has 8 buckets and collides above ~4 in-flight requests,
  // which is why the live journal shows a 🟢 DONE landing before the 🟡 that
  // started it. The emoji stays for the operator's own eye.
  const rid = requestId || nextRid();
  const reqTag = rid ? `${emojiTag} rid=${rid}`.trim() : emojiTag;

  const sourceFormat = sourceFormatOverride || detectFormat(body);
  const clientServiceTierSpecified = Object.prototype.hasOwnProperty.call(
    body,
    "service_tier",
  );

  // Check for bypass patterns (warmup, skip, cc naming) BEFORE tracking. These
  // return early and never reach completion, so they must not create a session
  // row that would linger as a phantom "active" entry on the dashboard.
  const bypassResponse = handleBypassRequest(
    body,
    model,
    ccFilterNaming,
  );
  if (bypassResponse) return bypassResponse;

  // Track as an active (concurrent) session for the dashboard. clientId is the
  // real client IP stamped by custom-server.js as x-tp-real-ip, which is the
  // only trustworthy source here: that wrapper deletes client-supplied
  // x-forwarded-for and trusts x-real-ip only from a loopback reverse proxy.
  // sessionId is the conversation-stable id resolved above. Fail-open: this
  // never blocks the request.
  try {
    const trackingHeaders = clientRawRequest?.headers || {};
    const clientId = trackingHeaders["x-tp-real-ip"] || "unknown";
    trackActiveSession({
      clientId,
      sessionId: sessionSeed,
      model,
      provider,
      connectionId,
    });
  } catch {
    // dashboard tracking must never break a request
  }

  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  // Multi-endpoint providers: pick transport matching sourceFormat → zero translation.
  // A model-level targetFormat overrides that choice, and the transport follows it so
  // the body format and the endpoint never diverge.
  const { targetFormat, transport: useTransport } = resolveUpstreamRoute({
    provider,
    alias,
    model,
    sourceFormat,
    credentials,
  });
  if (useTransport && credentials) credentials.runtimeTransport = useTransport;
  const stripList = getModelStrip(alias, model);
  const upstreamModel = getModelUpstreamId(alias, model);
  const clientTool = detectClientTool(clientRawRequest?.headers || {}, body);
  const passthrough = isNativePassthrough(clientTool, provider);

  // Inject provider-level thinking config. A translated, unlevelled Claude
  // marker lets an explicit provider level supply the missing effort.
  // on/off → extended type (body.thinking), none/low/medium/high → effort type (body.reasoning_effort)
  if (!passthrough && providerThinking?.mode && providerThinking.mode !== "auto") {
    const mode = providerThinking.mode;
    const clientThinking = extractThinking(body);
    const explicitClientEffort =
      body.reasoning_effort ?? body.reasoning?.effort;
    const hasExplicitClientEffort =
      typeof explicitClientEffort === "string" && explicitClientEffort !== "auto";
    const hasUnlevelledClaudeThinking =
      sourceFormat === FORMATS.CLAUDE &&
      body.thinking &&
      clientThinking?.mode === "auto";

    if (hasUnlevelledClaudeThinking && mode !== "on" && mode !== "off") {
      // The Claude shape wins extractThinking's precedence, so remove an
      // unlevelled enabled/adaptive marker before the configured level is
      // captured for a translated route. Keep an explicit client effort.
      body = { ...body };
      delete body.thinking;
      if (body.output_config?.effort === "auto") {
        const { effort: _effort, ...outputConfig } = body.output_config;
        if (Object.keys(outputConfig).length) body.output_config = outputConfig;
        else delete body.output_config;
      }
      if (body.reasoning_effort === "auto") delete body.reasoning_effort;
      if (body.reasoning?.effort === "auto") {
        const { effort: _effort, ...reasoning } = body.reasoning;
        if (Object.keys(reasoning).length) body.reasoning = reasoning;
        else delete body.reasoning;
      }
      if (!hasExplicitClientEffort) body.reasoning_effort = mode;
    } else if (mode === "on" && !body.thinking) {
      console.log("Injecting provider-level thinking config override: on");
      body = { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
    } else if (mode === "off" && !body.thinking) {
      body = { ...body, thinking: { type: "disabled" } };
    } else if (!body.reasoning_effort) {
      body = { ...body, reasoning_effort: mode };
    }
  }

  const clientRequestedStreaming = requestedStreaming(body, sourceFormat);
  const providerRequiresStreaming = PROVIDERS[provider]?.forceStream === true;
  let stream = providerRequiresStreaming ? true : clientRequestedStreaming;

  // Image generation models require non-streaming (Google v1internal:generateContent)
  const modelType = getModelType(alias, model);
  const isImageGenModel =
    modelType === "imageGen" || /image|imagen|image-generation/i.test(model);
  if (
    isImageGenModel &&
    (provider === "antigravity" || provider === "gemini-cli")
  ) {
    stream = false;
  }

  // DeepSeek-TUI: interactive TUI panel sends stream:true and needs SSE.
  // Non-interactive mode (-p flag) sends without stream and can't parse SSE.
  // Only force non-streaming when client didn't explicitly request it.
  if (clientTool === "deepseek-tui" && body.stream !== true) stream = false;

  // Check client Accept header preference for non-streaming requests
  // This fixes AI SDK compatibility where clients send Accept: application/json
  const acceptHeader = clientRawRequest?.headers?.accept || "";
  const clientPrefersJson = acceptHeader.includes("application/json");
  const clientPrefersSSE = acceptHeader.includes("text/event-stream");
  if (
    clientPrefersJson &&
    !clientPrefersSSE &&
    body.stream !== true &&
    !providerRequiresStreaming
  ) {
    stream = false;
  }

  const reqLogger = await createRequestLogger(
    sourceFormat,
    targetFormat,
    model,
  );
  if (clientRawRequest)
    reqLogger.logClientRawRequest(
      clientRawRequest.endpoint,
      clientRawRequest.body,
      clientRawRequest.headers,
    );
  reqLogger.logRawRequest(body);
  log?.debug?.(
    "FORMAT",
    `${sourceFormat} → ${targetFormat} | stream=${stream}`,
  );

  // Native passthrough: CLI tool and provider are the same ecosystem
  // Skip all translation/normalization — only model and Bearer are swapped
  // Expose raw client headers to translators/executors for session-id resolution
  if (credentials) credentials.rawHeaders = clientRawRequest?.headers || {};

  // Auto-strip media blocks the model can't read (vision/audio/pdf) before translation.
  if (!passthrough) {
    const caps = getCapabilitiesForModel(provider, model);
    if (stripUnsupportedModalities(body, sourceFormat, caps)) {
      log?.debug?.(
        "MODALITY",
        `stripped unsupported media for ${provider}/${model}`,
      );
    }
    // Convert remote image URLs to base64 for targets that can't fetch URLs.
    try {
      const n = await prefetchRemoteImages(body, sourceFormat, targetFormat, {
        signal: undefined,
      });
      if (n > 0)
        log?.debug?.(
          "MODALITY",
          `prefetched ${n} remote image(s) for ${targetFormat}`,
        );
    } catch (e) {
      log?.warn?.("MODALITY", `image prefetch failed: ${e.message}`);
    }
  }

  let translatedBody;
  let toolNameMap;
  let customToolNames;
  let responsesToolNameMap;
  if (passthrough) {
    log?.debug?.(
      "PASSTHROUGH",
      `${clientTool} → ${provider} | native lossless`,
    );
    translatedBody = { ...body, model: stripThinkingSuffix(upstreamModel) };
    // The Responses API takes reasoning.effort NESTED; a flat reasoning_effort is
    // rejected. Gating this on provider === "codex" meant the official OpenAI
    // provider, which is a distinct registry entry serving the same API, got the
    // flat field and answered 400 on gpt-5.6 (#3154). The condition that actually
    // matters is the wire format, not which provider happens to speak it.
    if (targetFormat === FORMATS.OPENAI_RESPONSES) {
      const suffixThinking = {};
      applyThinking(FORMATS.OPENAI, upstreamModel, suffixThinking, provider);
      if (suffixThinking.reasoning_effort) {
        const reasoning = translatedBody.reasoning;
        translatedBody.reasoning = {
          ...(reasoning &&
          typeof reasoning === "object" &&
          !Array.isArray(reasoning)
            ? reasoning
            : {}),
          effort: suffixThinking.reasoning_effort,
        };
        delete translatedBody.reasoning_effort;
      }
    }
    // Normalize newer Cowork/CC beta shapes (adaptive thinking, mid-conversation system) the API rejects
    if (clientTool === "claude") {
      normalizeClaudePassthrough(
        translatedBody,
        translatedBody.model,
        clientRawRequest?.headers || null,
      );
    }
  } else {
    translatedBody = translateRequest(
      sourceFormat,
      targetFormat,
      upstreamModel,
      body,
      stream,
      credentials,
      provider,
      reqLogger,
      stripList,
      connectionId,
      clientTool,
    );
    if (!translatedBody) {
      trackPendingRequest(model, provider, connectionId, false, true);
      return createErrorResult(
        HTTP_STATUS.BAD_REQUEST,
        `Failed to translate request for ${sourceFormat} → ${targetFormat}`,
      );
    }
    toolNameMap = translatedBody._toolNameMap;
    delete translatedBody._toolNameMap;
    customToolNames = translatedBody._customToolNames;
    delete translatedBody._customToolNames;
    responsesToolNameMap = translatedBody._responsesToolNameMap;
    delete translatedBody._responsesToolNameMap;
    translatedBody.model = stripThinkingSuffix(upstreamModel);
    translatedBody = stripContinuityFields(translatedBody, provider, model, log);
  }

  translatedBody = applyCodexFastMode(translatedBody, {
    provider,
    model,
    enabled: codexFastMode,
    clientServiceTierSpecified,
    clientServiceTier: body.service_tier,
  });

  // Sync the negotiated stream flag into the upstream body. `stream` may differ
  // from the client's body.stream (forceStream providers, Accept-header JSON
  // preference). Guarded: gemini-cli/antigravity passthrough bodies never carry
  // the key, and injecting stream:true into them would change the wire format.
  if ("stream" in translatedBody || providerRequiresStreaming) {
    if (translatedBody.stream !== stream) translatedBody.stream = stream;
  }

  // Tool normalization: MCP-equivalent built-in dedup (Claude clients) + same-name
  // dedup for DeepSeek models (upstream rejects duplicate tool names on all endpoints).
  if (Array.isArray(translatedBody.tools)) {
    const { tools: deduped, stripped } = dedupeTools(translatedBody.tools, { clientTool, model });
    if (stripped.length > 0) {
      translatedBody.tools = deduped;
      log?.debug?.(
        "TOOLDEDUP",
        `stripped ${stripped.length}: ${stripped.slice(0, 3).join(", ")}${stripped.length > 3 ? "..." : ""}`,
      );
    }
  }

  // Per-request opt-out: computed early so token savers (including disclosure) can respect it.
  const tokenSaverEnabled =
    clientRawRequest?.headers?.[TOKEN_SAVER_HEADER]?.toLowerCase?.() !== "off";

  // Progressive tool disclosure: static filter (Phase 1) + BM25 selection (Phase 2).
  // Runs after dedupeTools, before RTK/headroom. cache_control stamping is NOT
  // done here — anchorClaudeCache at the end of the pipeline stays the single
  // source of truth for cache breakpoints.
  if (Array.isArray(translatedBody.tools) && translatedBody.tools.length > 0) {
    const beforeN = translatedBody.tools.length;
    const beforeBytes = log?.debug
      ? JSON.stringify(translatedBody.tools).length
      : 0;

    if (tokenSaverEnabled) {
      if (toolDisclosure?.filterEnabled) {
        const filtered = toolFilter(translatedBody.tools, toolDisclosure);
        if (filtered.length < translatedBody.tools.length) {
          log?.debug?.(
            "TOOLDISCLOSE",
            `filter: ${translatedBody.tools.length}→${filtered.length} tools`,
          );
          translatedBody.tools = filtered;
        }
      }

      if (toolDisclosure?.disclosureEnabled) {
        const { tools: disclosed, stats } = disclosureTools(
          translatedBody.tools,
          body,
          connectionId,
          toolDisclosure,
        );
        if (stats) {
          log?.debug?.(
            "TOOLDISCLOSE",
            `bm25: ${stats.before}→${stats.after} tools (-${stats.stripped})`,
          );
          translatedBody.tools = disclosed;
        }
      }
    }

    const afterN = translatedBody.tools.length;
    if (log?.debug) {
      const afterBytes = JSON.stringify(translatedBody.tools).length;
      log.debug(
        "TOOLDISCLOSE",
        `measure: ${beforeN}tools ${beforeBytes}B → ${afterN}tools ${afterBytes}B`,
      );
    }
  }

  // Token savers: applied at the final body just before dispatch
  // Covers both passthrough (source shape) and translated (target shape) flows
  const finalFormat = passthrough ? sourceFormat : targetFormat;

  // Request line: one correlated summary (fmt + thinking + counts + account)
  if (log?.line) {
    const clientModel = clientRawRequest?.body?.model || `${provider}/${model}`;
    const msgN =
      translatedBody.messages?.length ||
      translatedBody.input?.length ||
      translatedBody.contents?.length ||
      body.messages?.length ||
      body.input?.length ||
      0;
    const toolN = translatedBody.tools?.length || body.tools?.length || 0;
    const fmtStr = passthrough
      ? `FMT: ${sourceFormat} (passthrough)`
      : `FMT: ${sourceFormat}→${targetFormat}`;
    const showThinking =
      provider !== "grok-cli" || supportsGrokCliReasoningEffort(model);
    const think = showThinking
      ? log.fmtThink?.(extractThinking(translatedBody))
      : null;
    const acc =
      credentials?.connectionName ||
      credentials?.connectionId?.slice(0, 8) ||
      "-";
    const parts = [
      `POST ${clientModel} → ${provider}/${model}`,
      fmtStr,
      stream ? "STREAM" : "JSON",
      `${msgN} MSG`,
    ];
    if (toolN) parts.push(`${toolN} TOOL`);
    if (think) parts.push(`THINK:${think}`);
    parts.push(`ACC:${acc}`);
    log.line(reqTag, "▶", parts.join(" · "));
  }

  // TTS models don't support tool messages/function calling
  if (getModelType(alias, model) === "tts" && translatedBody.messages) {
    translatedBody.messages = translatedBody.messages.filter(
      (msg) => msg.role !== "tool",
    );
    delete translatedBody.tools;
  }

  // RTK: compress tool_result content.
  //
  // compressMessages rewrites message content IN PLACE, and on the passthrough
  // path translatedBody is a shallow spread of the caller's body, so the array
  // and the message objects inside it are the caller's. Account fallback calls
  // this handler again with that same body, which meant attempt two compressed
  // the already-compressed text and each further attempt compressed it again
  // (#3566). Isolate the messages first, and only when the stage will actually
  // run, so a request with the saver off pays nothing.
  const rtkWillRun = tokenSaverEnabled && rtkEnabled;
  if (rtkWillRun) isolateCompressibleItems(translatedBody);
  const rtkStats = compressMessages(
    translatedBody,
    rtkWillRun,
  );
  const rtkLine = formatRtkLog(rtkStats);
  if (rtkLine) console.log(rtkLine);
  try {
    if (tokenSaverEnabled && rtkStats?.hits?.length) {
      const evt = {
        saver: "rtk",
        applied: true,
        appliedCount: rtkStats.hits.length,
        charsBefore: rtkStats.bytesBefore,
        charsAfter: rtkStats.bytesAfter,
        charsSaved: Math.max(
          0,
          (rtkStats.bytesBefore || 0) - (rtkStats.bytesAfter || 0),
        ),
      };
      if (typeof onTokenSaverEvent === "function") onTokenSaverEvent(evt);
    }
  } catch {
    /* stats must not break requests */
  }

  // Privacy filter (#2728): pseudonymise emails and operator terms in the
  // outbound body, and carry the mapping to the response path so the client
  // gets its own values back and never sees a placeholder. Off by default —
  // when off, nothing below this comment runs.
  //
  // Skipped for a forced-SSE-to-JSON request: handleForcedSSEToJson assembles
  // the client body outside the two handlers wired for restoration, and a
  // one-directional redaction that leaks aliases is worse than no filter.
  let privacyFilter = null;
  if (privacyEnabled && !(providerRequiresStreaming && !clientRequestedStreaming)) {
    // Same in-place hazard RTK has (#3566): on passthrough these are the
    // caller's own objects, and an account-fallback retry would hand a fresh
    // filter a body that is already aliased, leaving it with an empty mapping
    // and nothing to restore.
    if (!rtkWillRun) isolateCompressibleItems(translatedBody);
    if (translatedBody.system && typeof translatedBody.system === "object") {
      try {
        translatedBody.system = structuredClone(translatedBody.system);
      } catch {
        /* shared is a worse result, not a broken one */
      }
    }
    privacyFilter = redactOutbound(translatedBody, privacyTerms);
    if (privacyFilter)
      log?.debug?.("PRIVACY", `pseudonymised ${privacyFilter.size} value(s)`);
  }

  // Headroom: optional external proxy compression; fail open if proxy is absent.
  const headroomDiagnostics = {};
  const headroomStats = await compressWithHeadroom(translatedBody, {
    enabled: tokenSaverEnabled && headroomEnabled,
    url: headroomUrl,
    model: upstreamModel,
    format: finalFormat,
    compressUserMessages: headroomCompressUserMessages,
    timeoutMs: headroomTimeoutMs,
    diagnostics: headroomDiagnostics,
  });
  const headroomLine = formatHeadroomLog(headroomStats);
  const headroomSizeLine = formatHeadroomSizeLog(headroomDiagnostics);
  // Headroom aggregate event: only after bodyBytes actually shrank (diagnostics.after populated)
  try {
    if (
      tokenSaverEnabled &&
      Number.isFinite(headroomStats?.tokens_saved) &&
      headroomDiagnostics?.after
    ) {
      const evt = {
        saver: "headroom",
        applied: true,
        tokensBefore: headroomStats.tokens_before,
        tokensAfter: headroomStats.tokens_after,
        tokensSaved: headroomStats.tokens_saved,
        bodyBytesBefore: headroomDiagnostics.before?.bodyBytes,
        bodyBytesAfter: headroomDiagnostics.after?.bodyBytes,
      };
      if (typeof onTokenSaverEvent === "function") onTokenSaverEvent(evt);
    }
  } catch {
    /* stats must not break requests */
  }
  if (headroomLine) {
    log?.info?.(
      "HEADROOM",
      `${headroomLine}${headroomSizeLine ? ` | ${headroomSizeLine}` : ""}`,
    );
    if (isHeadroomPhantomSavings(headroomStats, headroomDiagnostics)) {
      log?.warn?.(
        "HEADROOM",
        `reported token delta, but outbound JSON shrank <5%; provider may bill near-original payload | ${formatHeadroomSizeLog(headroomDiagnostics)}`,
      );
    }
  } else if (tokenSaverEnabled)
    // Gating this warn on headroomEnabled meant the ONE case a user needs told
    // about, the toggle being off while the dashboard reads Running because the
    // proxy answers, was the case that logged nothing at all (#1956). Say why in
    // both cases; the reason already distinguishes them.
    log?.warn?.(
      "HEADROOM",
      `skipped: ${headroomEnabled ? (headroomDiagnostics.reason || "compression unavailable") : "disabled in settings"}${headroomDiagnostics.endpoint ? ` (${headroomDiagnostics.endpoint})` : ""}`,
    );

  // Token-saver flags accumulator for the single "⚙" log line below.
  const xf = [];

  // Caveman: inject terse-style system prompt
  if (tokenSaverEnabled && cavemanEnabled && cavemanLevel) {
    injectCaveman(translatedBody, finalFormat, cavemanLevel);
    xf.push(`CAVEMAN:${cavemanLevel}`);
  }

  // Ponytail: inject lazy-senior-dev system prompt
  if (tokenSaverEnabled && ponytailEnabled && ponytailLevel) {
    injectPonytail(translatedBody, finalFormat, ponytailLevel);
    xf.push(`PONYTAIL:${ponytailLevel}`);
  }

  // PXPIPE: image bulky context (Claude-format bodies only), last saver before dispatch
  let pxpipeSummary = null;
  if (pxpipeEnabled) {
    const pxpipeResult = await compressWithPxpipe(translatedBody, {
      enabled: tokenSaverEnabled,
      format: finalFormat,
      model: upstreamModel,
      minChars: pxpipeMinChars,
      timeoutMs: pxpipeTimeoutMs,
      transform: pxpipeTransform,
    });
    pxpipeSummary = pxpipeResult.summary;
    if (pxpipeResult.body) translatedBody = pxpipeResult.body;
    if (pxpipeSummary?.applied)
      xf.push(`PXPIPE:${pxpipeSummary.imageCount}img`);
    try {
      onPxpipeEvent?.({ provider, model, ...pxpipeSummary });
    } catch {
      /* stats must not break requests */
    }
  }

  // Memory & Context Optimizer (Tool & Media Pruning, Compaction, Cache Anchoring, Handoffs)
  if (tokenSaverEnabled && memorySettings) {
    // THE MODEL'S OWN WINDOW decides when history has to be cut, and the
    // capability table already knows it (1,000,000 for the Opus and Sonnet 5
    // class, and a conservative default for anything it has not heard of).
    // Without this the memory pipeline ran on fixed thresholds and pruned a
    // conversation occupying 3% of its window.
    const memoryCaps = getCapabilitiesForModel(provider, upstreamModel);
    const memRes = await applyMemoryEnhancements(translatedBody, {
      settings: memorySettings,
      targetFormat: finalFormat,
      contextWindow: memoryCaps?.contextWindow ?? null,
      log,
    });
    const memBudget = memRes.stats?.budget;
    if (memBudget) {
      // The occupancy line, on every request. It is the only way to see from a
      // journal that a session is actually using the window it pays for, and
      // it is what made the old behavior visible in the first place.
      xf.push(
        `CTX:${Math.round(memBudget.projectedAfter / 1000)}k`
        + `/${Math.round(memBudget.limit / 1000)}k`,
      );
    }
    if (memRes.stats?.toolPruning?.applied) {
      xf.push(
        `TOOL-PRUNE:~${Math.round(memRes.stats.toolPruning.savedChars / 4)}t`,
      );
    }
    if (memRes.stats?.mediaPruning?.applied) {
      xf.push(`MEDIA-PRUNE:${memRes.stats.mediaPruning.savedItems}`);
    }
    if (memRes.stats?.compaction?.applied) {
      xf.push(`COMPACT:${memRes.stats.compaction.savedTokens}t`);
    }
  }

  if (xf.length && log?.line) log.line(reqTag, "⚙", xf.join(" · "));

  // Pin cache breakpoints to the final body — every saver above can reshape
  // system/tools/messages, and a stale anchor costs a full prefix rewrite.
  // Gated on the FINAL format, not on native passthrough: prepareClaudeRequest
  // stamps the same breakpoints during translation, i.e. BEFORE tool/media
  // pruning and compaction run, so any non-Claude-CLI client reaching a
  // Claude-format upstream was left with an anchor pointing at a prefix that no
  // longer existed and paid the whole prompt uncached (#2808).
  if (finalFormat === FORMATS.CLAUDE) {
    // Anthropic requires tools[].type explicitly; strict compatible gateways
    // (MiniMax, error 2013) 400 a legacy payload that omits it. Defaulted here,
    // on the final body, so it covers native passthrough as well as every
    // translated route, and lands after the savers above reshape tools.
    if (Array.isArray(translatedBody.tools)) {
      translatedBody.tools = defaultClaudeToolType(translatedBody.tools);
    }
    anchorClaudeCache(translatedBody);
  }

  const executor = getExecutor(provider);
  trackPendingRequest(model, provider, connectionId, true);
  appendRequestLog({ model, provider, connectionId, status: "PENDING" }).catch(
    () => {},
  );

  const msgCount =
    translatedBody.messages?.length ||
    translatedBody.input?.length ||
    translatedBody.contents?.length ||
    translatedBody.request?.contents?.length ||
    0;
  log?.debug?.(
    "REQUEST",
    `${provider.toUpperCase()} | ${model} | ${msgCount} msgs`,
  );

  // Set once the response turns out to be streaming; finalizes the placeholder
  // requestDetail row on disconnect or upstream mid-stream error (the SSE
  // transform's flush()/cancel() never run on those paths).
  let abandonStreamingDetail = null;

  const streamController = createStreamController({
    onDisconnect: (reason) => {
      trackPendingRequest(model, provider, connectionId, false);
      abandonStreamingDetail?.(typeof reason?.reason === "string" ? reason.reason : "client_disconnected");
      if (onDisconnect) onDisconnect(reason);
    },
    onError: (err) => {
      trackPendingRequest(model, provider, connectionId, false);
      abandonStreamingDetail?.(err?.message === "stream stall timeout" ? "stall_timeout" : "stream_error");
    },
    log,
    provider,
    model,
    reqTag,
  });
  const executionSignal = callerSignal
    ? AbortSignal.any([callerSignal, streamController.signal])
    : streamController.signal;

  const proxyOptions = {
    connectionProxyEnabled:
      credentials?.providerSpecificData?.connectionProxyEnabled === true,
    connectionProxyUrl:
      credentials?.providerSpecificData?.connectionProxyUrl || "",
    connectionNoProxy:
      credentials?.providerSpecificData?.connectionNoProxy || "",
    vercelRelayUrl: credentials?.providerSpecificData?.vercelRelayUrl || "",
    strictProxy: credentials?.providerSpecificData?.strictProxy === true,
  };

  logProxySelection({ proxyOptions, credentials, provider, model, log });

  // Execute request
  let providerResponse, providerUrl, providerHeaders, finalBody;
  // Most executors return their registry format. Cursor AgentService is an
  // exception: it is decoded by the executor into OpenAI-compatible output.
  let providerResponseFormat = targetFormat;
  const mapTransportError = (error) => {
    const isAntigravity = provider === "antigravity";
    const sinkError = isAntigravity ? ANTIGRAVITY_SAFE_ERROR_MESSAGE : (error.message || String(error));
    if (callerSignal?.aborted && (isCallerAbortError(error) || error.name === "AbortError")) {
      trackPendingRequest(model, provider, connectionId, false);
      return createCallerAbortResult();
    }
    trackPendingRequest(model, provider, connectionId, false, true);
    appendRequestLog({
      model,
      provider,
      connectionId,
      status: `FAILED ${error.name === "AbortError" ? 499 : HTTP_STATUS.BAD_GATEWAY}`,
    }).catch(() => {});
    saveRequestDetail(
      buildRequestDetail({
        provider,
        model,
        connectionId,
        latency: { ttft: 0, total: Date.now() - requestStartTime },
        tokens: { prompt_tokens: 0, completion_tokens: 0 },
        request: extractRequestConfig(body, stream),
        providerRequest: translatedBody || null,
        response: {
          error: sinkError,
          status: error.name === "AbortError" ? 499 : 502,
          thinking: null,
        },
        pxpipe: pxpipeSummary,
        status: "error",
      }),
    ).catch(() => {});

    if (error.name === "AbortError") {
      streamController.handleError(isAntigravity ? new Error(ANTIGRAVITY_SAFE_ERROR_MESSAGE) : error);
      return createErrorResult(499, isAntigravity ? ANTIGRAVITY_SAFE_ERROR_MESSAGE : "Request aborted");
    }
    const errMsg = isAntigravity
      ? ANTIGRAVITY_SAFE_ERROR_MESSAGE
      : formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    if (isBodyReadTimeoutError(error)) {
      return createErrorResult(
        HTTP_STATUS.GATEWAY_TIMEOUT,
        isAntigravity ? ANTIGRAVITY_SAFE_ERROR_MESSAGE : "Upstream response body timed out",
      );
    }
    if (log?.errorLine) {
      log.errorLine(
        reqTag,
        "✗",
        `ERROR 502 · ${provider}/${model} · ${Date.now() - requestStartTime}ms\n    ${errMsg}${!isAntigravity && error.stack ? `\n    ${error.stack}` : ""}`,
      );
    }
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  };
  try {
    const result = await executor.execute({
      model,
      body: translatedBody,
      stream,
      credentials,
      signal: executionSignal,
      log,
      proxyOptions,
      sourceFormat,
      targetFormat,
      toolNameMap,
      connectTimeout,
    });
    providerResponse = result.response;
    providerUrl = result.url;
    providerHeaders = result.headers;
    finalBody = result.transformedBody;
    providerResponseFormat = result.responseFormat || targetFormat;
    reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);
  } catch (error) {
    return mapTransportError(error);
  }

  // Handle 401/403 - try token refresh (skip for noAuth providers)
  if (
    !executor.noAuth &&
    (providerResponse.status === HTTP_STATUS.UNAUTHORIZED ||
      providerResponse.status === HTTP_STATUS.FORBIDDEN)
  ) {
    try {
      // Mutate credentials after each successful refresh: rotating refresh_token
      // providers (xAI/grok-cli) issue a new RT on every refresh; without this,
      // refreshWithRetry's 2nd/3rd attempt reuses the already-consumed RT →
      // invalid_grant → auth_failed retryable=false.
      const newCredentials = await refreshWithRetry(
        async () => {
          const result = await executor.refreshCredentials(credentials, log);
          if (
            result?.refreshToken &&
            result.refreshToken !== credentials.refreshToken
          ) {
            if (result.accessToken)
              credentials.accessToken = result.accessToken;
            credentials.refreshToken = result.refreshToken;
          }
          return result;
        },
        3,
        log,
      );
      if (newCredentials?.accessToken || newCredentials?.copilotToken) {
        if (log?.line)
          log.line(reqTag, "🔑", `TOKEN REFRESHED · ${provider}/${model}`);
        Object.assign(credentials, newCredentials);
        if (onCredentialsRefreshed) {
          try {
            await onCredentialsRefreshed(newCredentials);
          } catch (e) {
            log?.warn?.("TOKEN", `onCredentialsRefreshed failed: ${e.message}`);
          }
        }
        try {
          const retryResult = await executor.execute({
            model,
            body: translatedBody,
            stream,
            credentials,
            signal: executionSignal,
            log,
            proxyOptions,
            sourceFormat,
            targetFormat,
            toolNameMap,
            connectTimeout,
          });
          providerResponse = retryResult.response;
          providerUrl = retryResult.url;
          providerHeaders = retryResult.headers;
          finalBody = retryResult.transformedBody;
          providerResponseFormat = retryResult.responseFormat || targetFormat;
          reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);
        } catch (error) {
          return mapTransportError(error);
        }
      } else {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
      }
    } catch (e) {
      log?.warn?.(
        "TOKEN",
        `${provider.toUpperCase()} | refresh threw: ${provider === "antigravity" ? ANTIGRAVITY_SAFE_ERROR_MESSAGE : e.message}`,
      );
    }
  }

  // Provider returned error
  if (!providerResponse.ok) {
    trackPendingRequest(model, provider, connectionId, false, true);
    const { statusCode, message, resetsAtMs, validation, errorPayload } = await parseUpstreamError(
      providerResponse,
      executor,
    );
    const safeStatusCode = Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600
      ? statusCode
      : HTTP_STATUS.BAD_GATEWAY;

    if (validation && typeof onValidationRequired === "function") {
      try {
        await onValidationRequired({
          validation,
          observationId: verificationContext?.observationId,
        });
      } catch {
        log?.warn?.("VERIFICATION", `validation callback failed for ${String(connectionId).slice(0, 8)}`);
      }
    }
    const failureMetadata = projectClientModelStatus({
      provider,
      requestedModel: model,
      status: statusCode,
      payload: errorPayload,
    });

    // Adaptive unsupported-parameter retry: on a 400 naming rejected fields,
    // record them per provider+model, strip, and retry once immediately.
    const rejectedOn400 =
      statusCode === HTTP_STATUS.BAD_REQUEST
        ? extractRejectedFieldNamesFromError(message).filter((f) => {
            const existing = getRejectedFields(provider, model);
            return !existing.has(f.toLowerCase());
          })
        : [];

    if (rejectedOn400.length > 0) {
      log?.debug?.(
        "FIELDSTRIP",
        `Parsed fields: ${JSON.stringify(rejectedOn400)} provider=${provider} model=${model}`,
      );
      addRejectedFields(provider, model, rejectedOn400);
      const stripped = stripRejectedFields(translatedBody, provider, model);
      if (stripped) {
        log?.debug?.(
          "FIELDSTRIP",
          `Stripped body sent. Fields blocked: ${rejectedOn400.join(", ")}`,
        );
        try {
          const retryResult = await executor.execute({
            model,
            body: stripped,
            stream,
            credentials,
            signal: executionSignal,
            log,
            proxyOptions,
            sourceFormat,
            targetFormat,
            toolNameMap,
            connectTimeout,
          });
          if (retryResult.response.ok) {
            providerResponse = retryResult.response;
            providerUrl = retryResult.url;
            providerResponseFormat = retryResult.responseFormat || targetFormat;
            translatedBody = stripped;
            trackPendingRequest(model, provider, connectionId, false);
            appendRequestLog({
              model,
              provider,
              connectionId,
              status: "OK after field-strip",
            }).catch(() => {});
            log?.debug?.("FIELDSTRIP", `Retry succeeded for ${provider}/${model}`);
            const sharedCtx = {
              provider,
              model,
              body,
              stream,
              translatedBody,
              finalBody,
              requestStartTime,
              connectionId,
              apiKey,
              clientRawRequest,
              onRequestSuccess,
              verificationContext,
              onValidationRequired,
              notifyTerminalVerificationSuccess,
              pxpipe: pxpipeSummary,
              privacyFilter,
              callerSignal,
              reqTag,
              log,
            };
            const appendLog = (extra) =>
              appendRequestLog({ model, provider, connectionId, ...extra }).catch(
                () => {},
              );
            const trackDone = () =>
              trackPendingRequest(model, provider, connectionId, false);
            if (!clientRequestedStreaming && providerRequiresStreaming) {
              const s2j = await handleForcedSSEToJson({
                ...sharedCtx,
                providerResponse,
                sourceFormat,
                targetFormat: providerResponseFormat,
                toolNameMap,
                customToolNames,
                responsesToolNameMap,
                trackDone,
                appendLog,
              });
              if (s2j) {
                if (s2j.success) streamController.handleComplete();
                return s2j;
              }
            }
            if (!stream) {
              const nr = await handleNonStreamingResponse({
                ...sharedCtx,
                providerResponse,
                sourceFormat,
                targetFormat: providerResponseFormat,
                reqLogger,
                toolNameMap,
                customToolNames,
                responsesToolNameMap,
                trackDone,
                appendLog,
              });
              if (nr.success) streamController.handleComplete();
              return nr;
            }
            const { onStreamComplete, onStreamAbandoned, streamDetailId, streamState } =
              buildOnStreamComplete({ ...sharedCtx });
            abandonStreamingDetail = onStreamAbandoned;
            return handleStreamingResponse({
              ...sharedCtx,
              providerResponse,
              sourceFormat,
              targetFormat: providerResponseFormat,
              userAgent,
              reqLogger,
              toolNameMap,
              customToolNames,
              responsesToolNameMap,
              streamController,
              onStreamComplete,
              streamDetailId,
              streamState,
            });
          } else {
            log?.warn?.(
              "FIELDSTRIP",
              `Retry still failed: ${retryResult.response.status} ${retryResult.response.statusText}`,
            );
          }
        } catch (e) {
          if (e.name === "AbortError" || isConnectTimeoutError(e)) {
            return mapTransportError(e);
          }
          log?.warn?.("FIELDSTRIP", `Retry threw: ${provider === "antigravity" ? ANTIGRAVITY_SAFE_ERROR_MESSAGE : e.message}`);
        }
      } else {
        log?.warn?.(
          "FIELDSTRIP",
          "stripRejectedFields returned null — no fields to strip or body unchanged",
        );
      }
    } else if (statusCode !== HTTP_STATUS.BAD_REQUEST) {
      log?.debug?.(
        "FIELDSTRIP",
        `No rejected fields parsed from error (statusCode=${statusCode})`,
      );
    }

    appendRequestLog({
      model,
      provider,
      connectionId,
      status: `FAILED ${safeStatusCode}`,
    }).catch(() => {});
    const sinkMessage = provider === "antigravity" ? ANTIGRAVITY_SAFE_ERROR_MESSAGE : message;
    saveRequestDetail(
      buildRequestDetail({
        provider,
        model,
        connectionId,
        latency: { ttft: 0, total: Date.now() - requestStartTime },
        tokens: { prompt_tokens: 0, completion_tokens: 0 },
        request: extractRequestConfig(body, stream),
        providerRequest: finalBody || translatedBody || null,
        response: { error: sinkMessage, status: safeStatusCode, thinking: null },
        pxpipe: pxpipeSummary,
        status: "error",
      }),
    ).catch(() => {});

    const errMsg = provider === "antigravity"
      ? ANTIGRAVITY_SAFE_ERROR_MESSAGE
      : formatProviderError(new Error(message), provider, model, safeStatusCode);
    if (log?.errorLine) {
      const urlStr = provider !== "antigravity" && providerUrl ? `\n    URL: ${providerUrl}` : "";
      log.errorLine(
        reqTag,
        "✗",
        `ERROR ${safeStatusCode} · ${provider}/${model} · ${Date.now() - requestStartTime}ms${urlStr}\n    ${errMsg}`,
      );
    }
    reqLogger.logError(new Error(sinkMessage), finalBody || translatedBody);
    return createErrorResult(safeStatusCode, errMsg, resetsAtMs, failureMetadata);
  }

  const sharedCtx = {
    provider,
    model,
    body,
    stream,
    translatedBody,
    finalBody,
    requestStartTime,
    connectionId,
    apiKey,
    clientRawRequest,
    onRequestSuccess,
    verificationContext,
    onValidationRequired,
    notifyTerminalVerificationSuccess,
    onEmptyStream,
    pxpipe: pxpipeSummary,
    privacyFilter,
    callerSignal,
    reqTag,
    log,
  };
  const appendLog = (extra) =>
    appendRequestLog({ model, provider, connectionId, ...extra }).catch(
      () => {},
    );
  const trackDone = () =>
    trackPendingRequest(model, provider, connectionId, false);
  // Provider forced streaming but client wants JSON
  if (!clientRequestedStreaming && providerRequiresStreaming) {
    const result = await handleForcedSSEToJson({
      ...sharedCtx,
      providerResponse,
      sourceFormat,
      targetFormat: providerResponseFormat,
      toolNameMap,
      customToolNames,
      responsesToolNameMap,
      trackDone,
      appendLog,
    });
    if (result) {
      if (result.success) streamController.handleComplete();
      return result;
    }
  }

  // True non-streaming response
  if (!stream) {
    const result = await handleNonStreamingResponse({
      ...sharedCtx,
      providerResponse,
      sourceFormat,
      targetFormat: providerResponseFormat,
      reqLogger,
      toolNameMap,
      customToolNames,
      responsesToolNameMap,
      trackDone,
      appendLog,
    });
    if (result.success) streamController.handleComplete();
    return result;
  }

  // Streaming response
  const { onStreamComplete, onStreamAbandoned, streamDetailId, streamState } =
    buildOnStreamComplete({ ...sharedCtx });
  abandonStreamingDetail = onStreamAbandoned;
  return handleStreamingResponse({
    ...sharedCtx,
    providerResponse,
    sourceFormat,
    targetFormat: providerResponseFormat,
    userAgent,
    reqLogger,
    toolNameMap,
    customToolNames,
    responsesToolNameMap,
    streamController,
    onStreamComplete,
    streamDetailId,
    streamState,
  });
}

export function isTokenExpiringSoon(expiresAt, bufferMs = 5 * 60 * 1000) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - Date.now() < bufferMs;
}
