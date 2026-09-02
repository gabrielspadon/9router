import { getCapabilitiesForModel } from "../../providers/capabilities.js";

// Strip request params a given provider/model rejects upstream (e.g. HTTP 400).
// Config-driven: add a rule instead of scattering `delete body.x` across executors.

// Each rule: optional provider, regex match on model, list of params to drop.
// A param is removed only when it is present (!== undefined).
const STRIP_RULES = [
  // All Claude models: temperature deprecated/rejected upstream (Anthropic 400). #1748
  { match: /claude/i, drop: ["temperature"] },
  // GitHub Copilot gpt-5.4: temperature unsupported.
  { provider: "github", match: /gpt-5\.4/i, drop: ["temperature"] },
  // GitHub Copilot Claude (except opus/sonnet 4.6): thinking + reasoning_effort rejected. #713
  {
    provider: "github",
    match: (m) => /claude/i.test(m) && !/claude.*(opus|sonnet).*4\.6/i.test(m),
    drop: ["thinking", "reasoning_effort"],
  },
  // Cloudflare Workers AI: content must be plain string, rejects OpenAI content-part array (#1926)
  { provider: "cloudflare-ai", flattenContent: true },
  // Groq is a strict OpenAI-schema gateway: an unknown top-level property is a
  // hard 400, "property 'enable_thinking' is unsupported", and every request
  // fails until the client strips it (#3014). It serves qwen/qwen3.6-27b, whose
  // id resolves to the qwen thinking format once the vendor prefix is stripped,
  // so TokenProxy emitted a field Groq has no schema for. reasoning_effort is NOT
  // dropped: Groq accepts it on the gpt-oss models, and removing it would take
  // away working control to fix a different field.
  { provider: "groq", drop: ["enable_thinking", "thinking"] },
  // Mistral requires that a tool message be followed by an assistant message.
  // Its own docs: "Assistant messages with 'tool_calls' cannot have 'content'
  // and must be followed by a 'tool' message, which is then followed by another
  // assistant message." An OpenAI client may legitimately start a new user turn
  // straight after tool results, and Mistral answers 400 "Unexpected role 'user'
  // after role 'tool'" (#1152). Keyed on the MODEL, not the provider, because
  // the constraint travels with the model: it was reported through NVIDIA NIM,
  // which hosts Mistral and is a different provider entry.
  { match: /mistral|magistral|ministral|codestral|devstral/i, assistantAfterToolResults: true },
  // Mistral: rejects reasoning_content carried in assistant message history with
  // 422 extra_forbidden. Reasoning models (DeepSeek R1, mimo, o-series, etc.) emit
  // this field on assistant turns; it is only meaningful in streamed responses, not
  // in request bodies. Strip it from every message before forwarding. #1649
  { provider: "mistral", dropMessageFields: ["reasoning_content"] },
  // OpenCode Muse models: upstream rejects /chat/completions (500) and max_tokens (400),
  // requires Responses API endpoint and no max_tokens / max_completion_tokens.
  {
    provider: "opencode",
    match: /muse/i,
    drop: ["max_tokens", "max_completion_tokens"],
  },
  // VolcEngine Ark rejects GLM-5.x max_tokens above 128000 (#2428), even though
  // GLM-5.2's advertised ceiling is 131072 — pin an explicit endpoint cap so the
  // global GLM-5.2 caps change doesn't leak past Ark's real upstream limit.
  // min() with the model ceiling still applies if a variant's own limit is lower.
  {
    provider: "volcengine-ark",
    match: /glm-5/i,
    maxOutputCap: 128000,
    clampToModelMaxOutput: true,
  },
  // VolcEngine Ark caps the Kimi family at max_tokens <= 32768, but the model's
  // advertised ceiling is far higher (Kimi-K2.7-Code resolves to maxOutput 262144),
  // so clampToModelMaxOutput alone leaves it uncapped and the request 400s with
  // "integer above maximum value, expected <= 32768". Pin an explicit endpoint cap;
  // min() with the model ceiling still applies if a variant's own limit is lower.
  {
    provider: "volcengine-ark",
    match: /kimi/i,
    maxOutputCap: 32768,
    clampToModelMaxOutput: true,
  },
];

// Test a rule's match (regex or predicate) against the model id.
// A rule with no match clause applies to every model for its provider.
function matches(rule, model) {
  if (!rule.match) return true;
  return typeof rule.match === "function"
    ? rule.match(model)
    : rule.match.test(model);
}

function clampNumber(body, key, ceiling) {
  if (
    typeof body[key] === "number" &&
    Number.isFinite(body[key]) &&
    body[key] > ceiling
  ) {
    body[key] = ceiling;
  }
}

// Remove unsupported params from body in place; returns body.
export function stripUnsupportedParams(provider, model, body) {
  if (!model || !body || typeof body !== "object") return body;
  if (
    provider !== "claude" &&
    provider !== "anthropic" &&
    !provider?.startsWith?.("anthropic-compatible") &&
    body.context_management !== undefined
  ) {
    delete body.context_management;
  }
  for (const rule of STRIP_RULES) {
    if (rule.provider && rule.provider !== provider) continue;
    if (!matches(rule, model)) continue;
    // Drop top-level params (guard: a rule may omit `drop`, e.g. message-only rules).
    for (const key of rule.drop || []) {
      if (body[key] !== undefined) delete body[key];
    }
    // Drop per-message fields some providers reject in history, e.g. Mistral rejects
    // assistant reasoning_content with 422 extra_forbidden (#1649).
    if (Array.isArray(rule.dropMessageFields) && Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (!msg || typeof msg !== "object") continue;
        for (const field of rule.dropMessageFields) {
          if (msg[field] !== undefined) delete msg[field];
        }
      }
    }
    // CF Workers AI oneOf root schema only accepts content as plain string (#1926).
    //
    // Flattening mapped every non-text block to "" and joined, so an image was
    // silently discarded and the request went upstream looking like a text-only
    // question the user never asked. Cloudflare ships vision-capable models
    // (kimi-k2.5, kimi-k2.6), and for those the array form is the correct shape.
    //
    // So flatten only a message that is entirely text. A message carrying media
    // keeps its array: a vision model then works, and a text-only model rejects
    // it loudly instead of answering a question the image was part of (#2749).
    if (rule.flattenContent && Array.isArray(body.messages)) {
      // Keyed on the MODEL, not on whether a message happens to carry media. A
      // text-only model cannot use an image either way, so flattening it away
      // and answering the text is the graceful degradation #1926 intended. A
      // vision model must keep the array or the image is lost for nothing.
      const canSeeImages = getCapabilitiesForModel(provider, model).vision === true;
      if (!canSeeImages) {
        for (const msg of body.messages) {
          if (msg && Array.isArray(msg.content)) {
            msg.content = msg.content
              .map((b) => (b?.type === "text" && typeof b.text === "string" ? b.text : ""))
              .join("");
          }
        }
      }
    }
    // Insert the assistant turn Mistral requires between tool results and a new
    // user message. An empty string is used rather than invented prose: the
    // shape is what the upstream validates, and putting words in the model's
    // mouth would change what it is answering.
    if (rule.assistantAfterToolResults && Array.isArray(body.messages)) {
      const repaired = [];
      for (let i = 0; i < body.messages.length; i++) {
        const msg = body.messages[i];
        repaired.push(msg);
        const next = body.messages[i + 1];
        if (msg?.role === "tool" && next && next.role !== "tool" && next.role !== "assistant") {
          repaired.push({ role: "assistant", content: "" });
        }
      }
      if (repaired.length !== body.messages.length) body.messages = repaired;
    }
    if (rule.clampToModelMaxOutput || Number.isFinite(rule.maxOutputCap)) {
      const modelCeiling = getCapabilitiesForModel(provider, model).maxOutput;
      const candidates = [];
      if (
        rule.clampToModelMaxOutput &&
        Number.isFinite(modelCeiling) &&
        modelCeiling > 0
      ) {
        candidates.push(modelCeiling);
      }
      if (Number.isFinite(rule.maxOutputCap) && rule.maxOutputCap > 0) {
        candidates.push(rule.maxOutputCap);
      }
      if (candidates.length > 0) {
        const ceiling = Math.min(...candidates);
        clampNumber(body, "max_tokens", ceiling);
        clampNumber(body, "max_completion_tokens", ceiling);
        clampNumber(body, "max_output_tokens", ceiling);
      }
    }
  }
  return body;
}
