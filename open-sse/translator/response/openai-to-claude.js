import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, CLAUDE_BLOCK, MODEL_FALLBACK, OPENAI_FINISH } from "../schema/index.js";
import { fromOpenAIFinish } from "../concerns/finishReason.js";
import { extractReasoningText } from "../concerns/reasoning.js";
import { mergeToolArguments } from "../concerns/toolCall.js";

// Legacy "proxy_" prefix used by older request translators. Response strips it
// defensively so tool names from such turns resolve back (e.g. proxy_Read → Read
// for arg sanitization). Current request translator emits no prefix ("") — strip
// is then a no-op. Kept intentionally; do NOT couple to request's empty prefix.
const CLAUDE_OAUTH_TOOL_PREFIX = "proxy_";

// Sanitize tool call arguments to fix bad params from non-Anthropic models
function sanitizeToolArgs(toolName, argsJson) {
  try {
    const args = JSON.parse(argsJson);
    const name = toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)
      ? toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length)
      : toolName;
    if (name === "Read") sanitizeReadArgs(args);
    return JSON.stringify(args);
  } catch {
    return argsJson;
  }
}

function sanitizeReadArgs(args) {
  if (typeof args.limit === "string" && /^\d+$/.test(args.limit)) args.limit = Number(args.limit);
  if (typeof args.offset === "string" && /^-?\d+$/.test(args.offset)) args.offset = Number(args.offset);

  if (typeof args.limit === "number") {
    if (args.limit > 2000) args.limit = 2000;
    if (args.limit < 1) delete args.limit;
  }
  if (typeof args.offset === "number" && args.offset < 0) args.offset = 0;

  if ("pages" in args && !isValidPdfPagesArg(args.file_path, args.pages)) {
    delete args.pages;
  }
}

function isValidPdfPagesArg(filePath, pages) {
  return typeof filePath === "string" &&
    filePath.toLowerCase().endsWith(".pdf") &&
    typeof pages === "string" &&
    /^\d+(?:-\d+)?$/.test(pages);
}

// The upstream's own price for this turn. A gateway that resells several
// providers is the only party that knows what the call actually cost — every
// local figure is a per-token estimate against a published rate card, and it is
// wrong the moment the gateway takes a margin or routes to a cheaper upstream.
//
// Two spellings, both seen in the wild: a flat `cost`, and a `cost_details`
// breakdown whose `upstream_inference_cost` is the inference portion. A finite
// number wins, including 0 — a free-tier route really did cost nothing, and
// re-estimating it would invent a charge.
export function resolveProviderCost(usage) {
  if (!usage || typeof usage !== "object") return undefined;
  if (Number.isFinite(usage.cost)) return usage.cost;
  if (Number.isFinite(usage.cost_details?.upstream_inference_cost)) {
    return usage.cost_details.upstream_inference_cost;
  }
  return undefined;
}

// Close the Claude message for a finish_reason whose terminal was held back
// waiting for authoritative usage. No-op unless one is pending, so it is safe
// to call from the usage-only path and from the flush.
function emitDeferredTerminal(state, results) {
  if (!state?.pendingFinishReason) return;
  const reason = state.pendingFinishReason;
  state.pendingFinishReason = null;
  results.push({
    type: "message_delta",
    delta: { stop_reason: convertFinishReason(reason) },
    usage: state.usage || { input_tokens: 0, output_tokens: 0 }
  });
  results.push({ type: "message_stop" });
}

// Open the Claude tool_use block for one index. The name travels in
// content_block_start and cannot be revised once emitted, which is why the
// caller waits until it actually knows it.
function openToolBlock(state, results, idx, id, name) {
  stopThinkingBlock(state, results);
  stopTextBlock(state, results);

  const toolBlockIndex = state.nextBlockIndex++;
  state.toolCalls.set(idx, { id, name: name || "", blockIndex: toolBlockIndex });

  // Strip prefix from tool name for response
  let toolName = name || "";
  if (toolName.startsWith(CLAUDE_OAUTH_TOOL_PREFIX)) {
    toolName = toolName.slice(CLAUDE_OAUTH_TOOL_PREFIX.length);
  }

  results.push({
    type: "content_block_start",
    index: toolBlockIndex,
    content_block: {
      type: CLAUDE_BLOCK.TOOL_USE,
      id,
      name: toolName,
      input: {}
    }
  });
}

// Helper: stop thinking block if started
function stopThinkingBlock(state, results) {
  if (!state.thinkingBlockStarted) return;
  results.push({
    type: "content_block_stop",
    index: state.thinkingBlockIndex
  });
  state.thinkingBlockStarted = false;
}

// Helper: stop text block if started
function stopTextBlock(state, results) {
  if (!state.textBlockStarted || state.textBlockClosed) return;
  state.textBlockClosed = true;
  results.push({
    type: "content_block_stop",
    index: state.textBlockIndex
  });
  state.textBlockStarted = false;
}

// stream.js flushes with a null chunk when the upstream ends. Tool arguments are
// buffered per index and emitted only by the finish_reason branch below, so a
// stream that closes without one — an upstream that sends `[DONE]` with no
// finish chunk, or a connection that drops — left every buffered byte in the map
// and the tool_use block open. The client keeps a tool call whose input never
// arrived and was never closed, which is the "cut off ... never closed" shape of
// #3416. The flush is the last point at which the block can still be closed, so
// drain it here rather than dropping it.
function drainToolBlocksAtFlush(state) {
  // A finish_reason that deferred its terminal waiting for usage that never
  // arrived (the upstream dropped, or promised include_usage and did not
  // deliver) still has to close the message: `data: [DONE]` is withheld from a
  // Claude client, so nothing else will.
  if (state?.pendingFinishReason) {
    const held = [];
    emitDeferredTerminal(state, held);
    return held;
  }
  if (state?.claudeTerminalEmitted) return null;
  if (!state?.toolCalls?.size && !state?.toolPending?.size) return null;
  state.claudeTerminalEmitted = true;

  const results = [];
  // A call whose name never arrived still has to reach the client, the same
  // salvage the finish_reason branch makes. Drained first so the loop below
  // sees the block it opens.
  if (state.toolPending?.size) {
    for (const [idx, pending] of state.toolPending) {
      if (pending.id) openToolBlock(state, results, idx, pending.id, pending.name);
    }
    state.toolPending.clear();
  }
  stopThinkingBlock(state, results);
  stopTextBlock(state, results);

  for (const [idx, toolInfo] of state.toolCalls) {
    const buffered = state.toolArgBuffers?.get(idx);
    if (buffered) {
      results.push({
        type: "content_block_delta",
        index: toolInfo.blockIndex,
        delta: { type: "input_json_delta", partial_json: sanitizeToolArgs(toolInfo.name, buffered) }
      });
    }
    results.push({ type: "content_block_stop", index: toolInfo.blockIndex });
  }
  state.toolArgBuffers?.clear();

  // Closing the blocks is not closing the MESSAGE. An Anthropic client treats
  // the turn as still generating until `message_stop`, and this stream has no
  // finish_reason chunk left to produce one. `data: [DONE]` is not in the
  // Anthropic wire protocol and stream.js deliberately withholds it from a
  // Claude client, so without a terminal here the client waits until its own
  // timeout with the tool call it can never dispatch — the "blocked by tool
  // calls" shape of #1490.
  state.finishReason = OPENAI_FINISH.TOOL_CALLS;
  results.push({
    type: "message_delta",
    delta: { stop_reason: convertFinishReason(OPENAI_FINISH.TOOL_CALLS) },
    usage: state.usage || { input_tokens: 0, output_tokens: 0 }
  });
  results.push({ type: "message_stop" });

  return results;
}

// Convert OpenAI stream chunk to Claude format
export function openaiToClaudeResponse(chunk, state) {
  if (!chunk) return drainToolBlocksAtFlush(state);

  const results = [];

  // Track usage from OpenAI chunk if available. Read BEFORE the choices test
  // below: with `stream_options.include_usage` the authoritative usage arrives
  // in its own trailing chunk that carries `choices: []` and nothing else, and
  // returning early on it threw away the only real token counts the stream ever
  // produced — every such request was then billed from an estimate.
  if (chunk.usage && typeof chunk.usage === "object") {
    const promptTokens = typeof chunk.usage.prompt_tokens === "number" ? chunk.usage.prompt_tokens : 0;
    const outputTokens = typeof chunk.usage.completion_tokens === "number" ? chunk.usage.completion_tokens : 0;

    // Extract cache tokens from prompt_tokens_details, then from the top level.
    // A gateway that aggregates several upstreams reports the cache read at the
    // top of `usage` (`cached_tokens`, or Anthropic's `cache_read_input_tokens`
    // when the upstream is Claude) and sends no `prompt_tokens_details` at all,
    // so reading only the nested breakdown billed every cached request at the
    // full input rate and showed the client a cache hit rate of zero.
    const cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens
      ?? chunk.usage.cached_tokens
      ?? chunk.usage.cache_read_input_tokens;
    const cacheCreationTokens = chunk.usage.prompt_tokens_details?.cache_creation_tokens
      ?? chunk.usage.cache_creation_input_tokens;
    const cacheReadTokens = typeof cachedTokens === "number" ? cachedTokens : 0;
    const cacheCreateTokens = typeof cacheCreationTokens === "number" ? cacheCreationTokens : 0;

    // input_tokens = prompt_tokens - cached_tokens - cache_creation_tokens
    // Because OpenAI's prompt_tokens includes all prompt-side tokens
    const inputTokens = promptTokens - cacheReadTokens - cacheCreateTokens;

    state.usage = {
      input_tokens: inputTokens,
      output_tokens: outputTokens
    };

    // Add cache_read_input_tokens if present
    if (cacheReadTokens > 0) {
      state.usage.cache_read_input_tokens = cacheReadTokens;
    }

    // Add cache_creation_input_tokens if present
    if (cacheCreateTokens > 0) {
      state.usage.cache_creation_input_tokens = cacheCreateTokens;
    }

    // The price the upstream actually charged. A gateway that resells several
    // providers knows the real figure and reports it; every local estimate is a
    // per-token guess against a published rate card, which is wrong the moment
    // the gateway applies its own margin or routes to a cheaper upstream. Kept
    // whenever it is a finite number so a genuine 0 (a free-tier route) is
    // reported as free rather than re-estimated into a charge.
    const providerCost = resolveProviderCost(chunk.usage);
    if (providerCost !== undefined) state.usage.cost = providerCost;

    // Note: completion_tokens_details.reasoning_tokens is already included in output_tokens
    // No need to add separately as Claude expects total output_tokens
  }

  // A chunk with no choice carries usage and nothing else. If the finish chunk
  // deferred its terminal waiting for exactly this, release it now.
  if (!chunk.choices?.[0]) {
    emitDeferredTerminal(state, results);
    return results.length > 0 ? results : null;
  }

  const choice = chunk.choices[0];
  const delta = choice.delta;

  // Every branch below opens or extends a content block, and the client's
  // message is already closed once `message_stop` went out. A provider that
  // keeps sending after its finish_reason chunk — a trailing content frame, a
  // repeated terminal — otherwise produced a `content_block_delta` with no open
  // message, which the Anthropic client reports as "Received
  // content_block_delta without a current message" and then abandons the whole
  // turn (#1733). Placed after the usage block above, which is the one thing a
  // trailing frame legitimately carries and is still worth absorbing.
  if (state.claudeTerminalEmitted) {
    // Report a late tool-argument fragment before dropping the chunk. Nothing
    // here can deliver it: its tool_use block is already stopped, so the client
    // keeps a truncated argument string that does not parse, which is the "cut
    // off mid-string and never closed" shape of #3416. The silent drop is what
    // made it undiagnosable, so the drop stays and the silence does not.
    for (const tc of chunk.choices?.[0]?.delta?.tool_calls || []) {
      if (typeof tc?.function?.arguments !== "string" || !tc.function.arguments) continue;
      console.warn(
        `[Translator] tool argument fragment arrived after the stream terminal `
        + `(tool index ${tc.index ?? 0}, ${tc.function.arguments.length} bytes) — the client's `
        + `copy of this tool call is truncated`
      );
    }
    return null;
  }

  // First chunk - ALWAYS send message_start first
  if (!state.messageStartSent) {
    state.messageStartSent = true;
    state.messageId = chunk.id?.replace("chatcmpl-", "") || `msg_${Date.now()}`;
    if (!state.messageId || state.messageId === "chat" || state.messageId.length < 8) {
      state.messageId = chunk.extend_fields?.requestId ||
        chunk.extend_fields?.traceId ||
        `msg_${Date.now()}`;
    }
    state.model = chunk.model || MODEL_FALLBACK;
    state.nextBlockIndex = 0;
    results.push({
      type: "message_start",
      message: {
        id: state.messageId,
        type: "message",
        role: ROLE.ASSISTANT,
        model: state.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    });
  }

  // Handle reasoning (thinking) across vendor shapes - GLM/DeepSeek/Qwen/MiniMax/etc.
  const reasoningContent = extractReasoningText(delta);
  if (reasoningContent) {
    stopTextBlock(state, results);

    if (!state.thinkingBlockStarted) {
      state.thinkingBlockIndex = state.nextBlockIndex++;
      state.thinkingBlockStarted = true;
      results.push({
        type: "content_block_start",
        index: state.thinkingBlockIndex,
        content_block: { type: CLAUDE_BLOCK.THINKING, thinking: "" }
      });
    }

    results.push({
      type: "content_block_delta",
      index: state.thinkingBlockIndex,
      delta: { type: "thinking_delta", thinking: reasoningContent }
    });
  }

  // Handle regular content
  if (delta?.content) {
    stopThinkingBlock(state, results);

    if (!state.textBlockStarted) {
      state.textBlockIndex = state.nextBlockIndex++;
      state.textBlockStarted = true;
      state.textBlockClosed = false;
      results.push({
        type: "content_block_start",
        index: state.textBlockIndex,
        content_block: { type: CLAUDE_BLOCK.TEXT, text: "" }
      });
    }

    results.push({
      type: "content_block_delta",
      index: state.textBlockIndex,
      delta: { type: "text_delta", text: delta.content }
    });
  }

  // Tool calls
  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0;

      // GLM/fireworks repeats id+null-name on every arg chunk, so the block
      // opens once per idx. It waits for the NAME as well as the id: a provider
      // may split them across chunks, and opening on the id alone froze
      // `name: ""` into content_block_start, which cannot be revised, leaving
      // the client a tool call it has no way to dispatch.
      if (!state.toolCalls.has(idx)) {
        if (!state.toolPending) state.toolPending = new Map();
        const pending = state.toolPending.get(idx) || {};
        if (tc.id) pending.id = tc.id;
        const incomingName = tc.function?.name;
        if (typeof incomingName === "string" && incomingName) pending.name = incomingName;
        state.toolPending.set(idx, pending);

        if (pending.id && pending.name) {
          openToolBlock(state, results, idx, pending.id, pending.name);
          state.toolPending.delete(idx);
        }
      }

      if (tc.function?.arguments) {
        // Buffer args instead of streaming — sanitize at finish to fix bad params.
        // Buffered by index rather than gated on the block existing: a provider
        // that sends an argument fragment before the chunk carrying the tool id
        // would otherwise have that fragment silently dropped, and the client
        // receives a tool input that is missing its opening bytes and does not
        // parse. The block that opens later reads the same buffer by index.
        if (!state.toolArgBuffers) state.toolArgBuffers = new Map();
        // Not every provider streams argument DELTAS. Some OpenAI-compatible
        // upstreams restate the whole accumulated string in every chunk, and a
        // blind append then yields `{...}{...}` in the one input_json_delta,
        // which no Anthropic client can parse ("Invalid tool parameters"). The
        // upstream status is 200, so nothing locks the model or fails over and
        // the turn is lost silently (#2869). A chunk that carries the buffer as
        // its own prefix is a restatement, not a fragment: replace it.
        // Delta, cumulative restatement and terminal replay all arrive on this
        // one field; mergeToolArguments is the single place that tells them
        // apart (see its docstring in concerns/toolCall.js).
        state.toolArgBuffers.set(
          idx,
          mergeToolArguments(state.toolArgBuffers.get(idx), tc.function.arguments)
        );
      }
    }
  }

  // Finish
  if (choice.finish_reason) {
    // Once only. A provider that repeats finish_reason on a trailing usage chunk
    // otherwise re-emits the whole terminal set — including the buffered tool
    // arguments — and the client concatenates the two input_json_delta payloads
    // into `{...}{...}`, which is not parseable JSON.
    if (state.claudeTerminalEmitted) return results.length > 0 ? results : null;
    state.claudeTerminalEmitted = true;

    stopThinkingBlock(state, results);
    stopTextBlock(state, results);

    // A call whose name never arrived still has to reach the client: the model
    // asked for it, and dropping it silently is worse than an empty name.
    if (state.toolPending?.size) {
      for (const [idx, pending] of state.toolPending) {
        if (pending.id) openToolBlock(state, results, idx, pending.id, pending.name);
      }
      state.toolPending.clear();
    }

    for (const [idx, toolInfo] of state.toolCalls) {
      // Emit buffered + sanitized args as single delta before stop
      const buffered = state.toolArgBuffers?.get(idx);
      if (buffered) {
        const sanitized = sanitizeToolArgs(toolInfo.name, buffered);
        results.push({
          type: "content_block_delta",
          index: toolInfo.blockIndex,
          delta: { type: "input_json_delta", partial_json: sanitized }
        });
      }
      results.push({
        type: "content_block_stop",
        index: toolInfo.blockIndex
      });
    }
    state.toolArgBuffers?.clear();

    // Mark finish for later usage injection in stream.js
    state.finishReason = choice.finish_reason;

    // `stream_options.include_usage` is a two-part protocol: every chunk up to
    // and including the finish chunk carries an explicit `usage: null`, and the
    // real counts follow in a trailing chunk with no choices. Closing the
    // message on the finish chunk therefore reports zeros on precisely the
    // streams that were about to report the truth. The explicit null is the
    // signal — a provider that simply omits the field is not promising
    // anything, and its terminal goes out immediately as before.
    state.pendingFinishReason = choice.finish_reason;
    if (chunk.usage !== null) emitDeferredTerminal(state, results);
  }

  return results.length > 0 ? results : null;
}

const convertFinishReason = (reason) => fromOpenAIFinish(reason, "claude");

// Register
register(FORMATS.OPENAI, FORMATS.CLAUDE, null, openaiToClaudeResponse);
