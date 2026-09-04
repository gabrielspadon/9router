// Shared system-prompt injector: appends an instruction into the system message of
// the final request body, dispatching by format so it works for translated and
// native-passthrough flows. Used by caveman.js and ponytail.js.

import { FORMATS } from "../translator/formats.js";
import { ROLE, RESPONSES_ITEM, OPENAI_BLOCK } from "../translator/schema/index.js";

const SEP = "\n\n";

// Dedup guard: the first 100 chars of the prompt act as its signature. Multi-turn
// conversations replay the same system injection on every request, so appending
// without this check grows the system message unboundedly.
function isPromptAlreadyInjected(content, prompt) {
  if (!content || !prompt) return false;
  const needle = prompt.trim();
  if (!needle) return false;
  return content.includes(needle.slice(0, 100));
}

function extractTextFromOpenAIMessage(msg) {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) return msg.content.map(part => part?.text || "").join(" ");
  return "";
}

export function injectSystemPrompt(body, format, prompt) {
  if (!body || !prompt) return;

  switch (format) {
    case FORMATS.CLAUDE:
      injectClaudeSystem(body, prompt);
      return;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
    case FORMATS.ANTIGRAVITY:
      // Antigravity wraps Gemini shape in body.request → injectGeminiSystem handles it
      injectGeminiSystem(body, prompt);
      return;
    default:
      // OpenAI and OpenAI-shaped formats (responses/codex/cursor/kiro/ollama)
      injectMessagesSystem(body, format, prompt);
  }
}

// OpenAI-shaped: messages[] (chat) or input[] (responses) or instructions (responses string)
function injectMessagesSystem(body, format, prompt) {
  // OpenAI Responses API: top-level string field
  if (typeof body.instructions === "string") {
    if (isPromptAlreadyInjected(body.instructions, prompt)) return;
    body.instructions = body.instructions
      ? `${body.instructions}${SEP}${prompt}`
      : prompt;
    return;
  }

  const arr = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : null;
  if (!arr) return;

  // The array is picked by SHAPE while the format is a label, and the two can
  // disagree: a body carrying `input` is a Responses request whatever the label
  // says. Trusting the label alone unshifted an untyped {role, content} item
  // into a Responses input array, which the API rejects with
  // "Unknown parameter: 'input[0].content'" because an item with no type has no
  // content field. Derive it from the array actually chosen.
  const isResponses = format === FORMATS.OPENAI_RESPONSES || arr === body.input;
  const idx = arr.findIndex(m => m && (m.role === ROLE.SYSTEM || m.role === ROLE.DEVELOPER));
  if (idx >= 0) {
    if (isPromptAlreadyInjected(extractTextFromOpenAIMessage(arr[idx]), prompt)) return;
    appendToOpenAIMessage(arr[idx], prompt, isResponses);
  } else {
    arr.unshift(isResponses
      ? {
          type: RESPONSES_ITEM.MESSAGE,
          role: ROLE.SYSTEM,
          content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: prompt }],
        }
      : { role: ROLE.SYSTEM, content: prompt });
  }
}

function appendToOpenAIMessage(msg, prompt, isResponses) {
  if (isResponses) {
    // Responses API message items must carry both a message type and typed content.
    // This path is used when a native Responses request has no top-level instructions.
    msg.type = RESPONSES_ITEM.MESSAGE;
    if (typeof msg.content === "string") {
      msg.content = [{ type: RESPONSES_ITEM.INPUT_TEXT, text: `${msg.content}${SEP}${prompt}` }];
    } else if (Array.isArray(msg.content)) {
      msg.content.push({ type: RESPONSES_ITEM.INPUT_TEXT, text: prompt });
    } else {
      msg.content = [{ type: RESPONSES_ITEM.INPUT_TEXT, text: prompt }];
    }
    return;
  }

  if (typeof msg.content === "string") {
    msg.content = `${msg.content}${SEP}${prompt}`;
  } else if (Array.isArray(msg.content)) {
    // This is the NON-Responses branch, so `input_text` is the wrong part type
    // and a strict chat/completions provider rejects the request outright.
    // Mirror whatever the array already uses, and fall back to the
    // chat/completions spelling rather than the Responses one.
    const existing = msg.content.find((part) => typeof part?.type === "string")?.type;
    const partType = existing === RESPONSES_ITEM.INPUT_TEXT
      ? RESPONSES_ITEM.INPUT_TEXT
      : OPENAI_BLOCK.TEXT;
    msg.content.push({ type: partType, text: prompt });
  } else {
    msg.content = prompt;
  }
}

// Claude shape: body.system as string | array of {type:"text", text}
// Insert before the last cache_control block to keep injection inside the cached prefix.
function injectClaudeSystem(body, prompt) {
  if (typeof body.system === "string" && body.system.length > 0) {
    if (isPromptAlreadyInjected(body.system, prompt)) return;
    body.system = `${body.system}${SEP}${prompt}`;
    return;
  }
  if (Array.isArray(body.system)) {
    const existingText = body.system.map(block => block?.text || "").join(" ");
    if (isPromptAlreadyInjected(existingText, prompt)) return;
    const block = { type: "text", text: prompt };
    let lastCacheIdx = -1;
    for (let i = body.system.length - 1; i >= 0; i--) {
      if (body.system[i]?.cache_control) { lastCacheIdx = i; break; }
    }
    if (lastCacheIdx >= 0) {
      body.system.splice(lastCacheIdx, 0, block);
    } else {
      body.system.push(block);
    }
    return;
  }
  body.system = prompt;
}

// Gemini shape: body.system_instruction | body.systemInstruction | body.request.systemInstruction
// Each shape: { parts: [{ text }] }
function injectGeminiSystem(body, prompt) {
  const target = body.request && typeof body.request === "object" ? body.request : body;
  const useSnake = Object.prototype.hasOwnProperty.call(target, "system_instruction");
  const key = useSnake ? "system_instruction" : "systemInstruction";
  const sys = target[key];
  if (sys && Array.isArray(sys.parts)) {
    const existingText = sys.parts.map(part => part?.text || "").join(" ");
    if (isPromptAlreadyInjected(existingText, prompt)) return;
    sys.parts.push({ text: prompt });
    return;
  }
  if (typeof sys === "string") {
    // String-typed systemInstruction: coerce to parts, preserving the
    // original text, and dedup against the serialized existing instruction.
    if (isPromptAlreadyInjected(sys, prompt)) return;
    target[key] = sys
      ? { parts: [{ text: sys }, { text: prompt }] }
      : { parts: [{ text: prompt }] };
    return;
  }
  target[key] = { parts: [{ text: prompt }] };
}
