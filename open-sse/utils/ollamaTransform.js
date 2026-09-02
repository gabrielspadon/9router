// Ollama's own /api/chat answers `stream:false` with a single JSON object, and
// the chat handler already returns one (the non-stream and forced-SSE→JSON paths
// both end in a Chat Completions body). The NDJSON reader below drops every line
// that is not `data:`, so that answer — its tool calls, its usage, and the status
// of an error envelope — reached the client as one empty done:true message (#2348).
function jsonToOllama(response, model) {
  return response.text().then((text) => {
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON after all */ }
    const message = parsed?.choices?.[0]?.message;
    // An error envelope, or anything else that is not a completion, goes back
    // untouched and keeps its own status rather than becoming an empty 200.
    if (!message) {
      return new Response(text, {
        status: response.status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    const toolCalls = (message.tool_calls || []).map((tc) => ({
      function: {
        name: tc.function?.name,
        arguments: (() => {
          const raw = tc.function?.arguments;
          if (raw && typeof raw === "object") return raw;
          try { return JSON.parse(raw || "{}"); } catch { return {}; }
        })()
      }
    }));
    const usage = parsed.usage || {};

    return new Response(JSON.stringify({
      model,
      created_at: new Date().toISOString(),
      message: {
        role: message.role || "assistant",
        content: message.content || "",
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
      },
      done: true,
      done_reason: parsed.choices[0].finish_reason || "stop",
      ...(usage.prompt_tokens ? { prompt_eval_count: usage.prompt_tokens } : {}),
      ...(usage.completion_tokens ? { eval_count: usage.completion_tokens } : {})
    }), {
      status: response.status,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  });
}

// Transform OpenAI SSE stream to Ollama JSON lines format
export function transformToOllama(response, model) {
  // Only an explicitly JSON-typed body takes the non-stream projection: an SSE
  // upstream is either text/event-stream or carries no content-type at all.
  if (response.body && /application\/json/i.test(response.headers?.get?.("content-type") || "")) {
    return jsonToOllama(response, model);
  }

  let buffer = "";
  let pendingToolCalls = {};
  let doneSent = false;

  // One decoder for the whole stream. A multi-byte character split across two
  // network chunks has to be held until its remaining bytes arrive; decoding
  // each chunk on its own turns both halves into replacement characters.
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const encoder = new TextEncoder();

  const emit = (controller, message, done) => {
    controller.enqueue(encoder.encode(JSON.stringify({ model, message, done }) + "\n"));
  };

  // Ollama ends a stream with exactly one done:true message, and that message
  // carries the tool calls when there are any. Emitting more than one leaves a
  // client that keeps the last of them holding an empty message.
  const emitDone = (controller, message) => {
    if (doneSent) return;
    doneSent = true;
    emit(controller, message, true);
  };

  const handleLine = (line, controller) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();

    if (data === "[DONE]") {
      emitDone(controller, { role: "assistant", content: "" });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // Silently ignore parse errors
    }

    const delta = parsed.choices?.[0]?.delta || {};
    const content = delta.content || "";
    const toolCalls = delta.tool_calls;

    if (toolCalls) {
      for (const tc of toolCalls) {
        const idx = tc.index;
        if (!pendingToolCalls[idx]) {
          pendingToolCalls[idx] = { id: tc.id, function: { name: "", arguments: "" } };
        }
        if (tc.function?.name) pendingToolCalls[idx].function.name += tc.function.name;
        if (tc.function?.arguments) pendingToolCalls[idx].function.arguments += tc.function.arguments;
      }
    }

    if (content) {
      emit(controller, { role: "assistant", content }, false);
    }

    const finishReason = parsed.choices?.[0]?.finish_reason;
    if (finishReason === "tool_calls" || finishReason === "stop") {
      const toolCallsArr = Object.values(pendingToolCalls);
      if (toolCallsArr.length > 0) {
        const formattedCalls = toolCallsArr.map(tc => ({
          function: {
            name: tc.function.name,
            arguments: (() => { try { return JSON.parse(tc.function.arguments || "{}"); } catch { return {}; } })()
          }
        }));
        emitDone(controller, { role: "assistant", content: "", tool_calls: formattedCalls });
        pendingToolCalls = {};
      } else if (finishReason === "stop") {
        emitDone(controller, { role: "assistant", content: "" });
      }
    }
  };

  const transform = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) handleLine(line, controller);
    },
    flush(controller) {
      // A last line that arrived without its newline is still a line.
      buffer += decoder.decode();
      if (buffer.trim()) handleLine(buffer.trim(), controller);
      emitDone(controller, { role: "assistant", content: "" });
    }
  });

  if (!response.body) {
    return new Response("", { status: response.status, headers: { "Content-Type": "application/x-ndjson" } });
  }
  return new Response(response.body.pipeThrough(transform), {
    headers: { "Content-Type": "application/x-ndjson", "Access-Control-Allow-Origin": "*" }
  });
}
