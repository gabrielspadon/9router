import { register } from "../index.js";
import { rememberThoughtSignature } from "../concerns/thoughtSignature.js";
import { FORMATS } from "../formats.js";
import { adjustMaxTokens } from "../formats/maxTokens.js";
import { encodeDataUri } from "../concerns/image.js";
import { collapseTextParts } from "../concerns/message.js";
import { ROLE, GEMINI_ROLE, OPENAI_BLOCK } from "../schema/index.js";

// Convert Gemini request to OpenAI format
export function geminiToOpenAIRequest(model, body, stream) {
  const result = {
    model: model,
    messages: [],
    stream: stream
  };

  // Generation config
  if (body.generationConfig) {
    const config = body.generationConfig;
    if (config.maxOutputTokens) {
      const tempBody = { max_tokens: config.maxOutputTokens, tools: body.tools };
      result.max_tokens = adjustMaxTokens(tempBody);
    }
    if (config.temperature !== undefined) {
      result.temperature = config.temperature;
    }
    if (config.topP !== undefined) {
      result.top_p = config.topP;
    }
  }

  // System instruction
  if (body.systemInstruction) {
    const systemText = extractGeminiText(body.systemInstruction);
    if (systemText) {
      result.messages.push({
        role: ROLE.SYSTEM,
        content: systemText
      });
    }
  }

  // Convert contents to messages
  if (body.contents && Array.isArray(body.contents)) {
    for (const content of body.contents) {
      const converted = convertGeminiContent(content);
      // One content converts to several messages when it carries parallel tool
      // results, or a result co-located with a call or text (#2394).
      if (Array.isArray(converted)) result.messages.push(...converted);
      else if (converted) result.messages.push(converted);
    }
  }

  // Tools
  if (body.tools && Array.isArray(body.tools)) {
    result.tools = [];
    for (const tool of body.tools) {
      if (tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          result.tools.push({
            type: OPENAI_BLOCK.FUNCTION,
            function: {
              name: func.name,
              description: func.description || "",
              parameters: func.parameters || { type: "object", properties: {} }
            }
          });
        }
      }
    }
  }

  return result;
}

// Convert Gemini content to OpenAI message
function convertGeminiContent(content) {
  const role = content.role === GEMINI_ROLE.USER ? ROLE.USER : ROLE.ASSISTANT;
  
  if (!content.parts || !Array.isArray(content.parts)) {
    return null;
  }

  const parts = [];
  const toolCalls = [];
  const toolMessages = [];
  const reasoning = [];

  for (const part of content.parts) {
    if (part.text !== undefined) {
      // Gemini marks a thinking part as { text, thought: true }. Pushing it as
      // ordinary text merges the model's reasoning into visible content and
      // loses the distinction OpenAI carries as reasoning_content (#2400).
      if (part.thought === true) {
        if (part.text) reasoning.push(part.text);
        continue;
      }
      parts.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
    }

    if (part.inlineData) {
      parts.push({
        type: OPENAI_BLOCK.IMAGE_URL,
        image_url: {
          url: encodeDataUri(part.inlineData.mimeType, part.inlineData.data)
        }
      });
    }

    if (part.functionCall) {
      // Only an id upstream actually assigned is unique enough to key a
      // signature on; the name-derived fallback below repeats across calls
      // and would hand back the wrong one (#3646).
      rememberThoughtSignature(part.functionCall.id, part.thoughtSignature || part.thought_signature);
      // Gemini lacks a native call id; derive a deterministic one from the name so the
      // matching functionResponse maps to the same tool_call_id (providers require pairing).
      toolCalls.push({
        id: part.functionCall.id || `call_${part.functionCall.name}`,
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {})
        }
      });
    }

    if (part.functionResponse) {
      // Collect, do not return. Gemini emits one functionResponse per parallel
      // tool call in a single content, and returning on the first dropped every
      // other result — the model then answered with only one tool's output
      // (#2393).
      toolMessages.push({
        role: ROLE.TOOL,
        tool_call_id: part.functionResponse.id || `call_${part.functionResponse.name}`,
        content: JSON.stringify(part.functionResponse.response?.result || part.functionResponse.response || {})
      });
    }
  }

  // A tool result is its own message, but the parts beside it in the same
  // content are not part of it. Returning only the results dropped a
  // co-located functionCall or text, and the model then answered without the
  // half that was dropped (#2394). Results lead: they answer calls from an
  // earlier content, while anything left is a new turn.
  const remaining = buildOpenAIMessage(role, parts, toolCalls, reasoning);
  if (toolMessages.length === 0) return remaining;
  if (!remaining) return toolMessages.length === 1 ? toolMessages[0] : toolMessages;
  return [...toolMessages, remaining];
}

// The non-tool-result half of one Gemini content, as a single OpenAI message.
function buildOpenAIMessage(role, parts, toolCalls, reasoning) {
  if (toolCalls.length > 0) {
    // OpenAI carries tool_calls on the assistant turn only.
    const result = { role: ROLE.ASSISTANT };
    if (parts.length > 0) {
      result.content = parts.length === 1 ? parts[0].text : parts;
    }
    if (reasoning.length > 0) result.reasoning_content = reasoning.join("");
    result.tool_calls = toolCalls;
    return result;
  }

  if (parts.length > 0) {
    const result = { role, content: collapseTextParts(parts) };
    if (reasoning.length > 0 && role === ROLE.ASSISTANT) {
      result.reasoning_content = reasoning.join("");
    }
    return result;
  }

  // A thought-only turn stays an assistant message so the reasoning survives.
  if (reasoning.length > 0 && role === ROLE.ASSISTANT) {
    return { role, content: "", reasoning_content: reasoning.join("") };
  }

  return null;
}

// Extract text from Gemini content
function extractGeminiText(content) {
  if (typeof content === "string") return content;
  if (content.parts && Array.isArray(content.parts)) {
    return content.parts.map(p => p.text || "").join("");
  }
  return "";
}

// Register
register(FORMATS.GEMINI, FORMATS.OPENAI, geminiToOpenAIRequest, null);
register(FORMATS.GEMINI_CLI, FORMATS.OPENAI, geminiToOpenAIRequest, null);

