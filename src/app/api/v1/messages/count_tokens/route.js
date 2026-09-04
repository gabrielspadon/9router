const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

// A media block costs roughly its pixel count in tokens, not its encoded
// length. A 1 MB base64 screenshot is about 1,600 tokens and about 1,400,000
// characters, so counting it by length reported it as ~350,000 tokens — three
// orders of magnitude out, and enough on its own to convince a client that a
// conversation carrying two screenshots had filled a million-token window.
// Clients call this endpoint to decide when to compact, so the overcount made
// them compact almost immediately on any session with images in it. Charged
// flat instead: wrong by a factor of two at worst rather than a thousand.
const MEDIA_TOKENS = 1600;
const CHARS_PER_TOKEN = 4;
const MEDIA_CHARS = MEDIA_TOKENS * CHARS_PER_TOKEN;

function isMediaBlock(block) {
  if (!block || typeof block !== "object") return false;
  const t = block.type;
  return (
    t === "image"
    || t === "image_url"
    || t === "input_image"
    || t === "input_audio"
    || t === "audio"
    || t === "input_video"
    || t === "video"
    || t === "document"
    || t === "file"
    || Boolean(block.source?.data)
    || Boolean(block.source?.url)
    || Boolean(block.inlineData?.mimeType)
    || Boolean(block.fileData?.mimeType)
  );
}

function countValueChars(value) {
  if (value == null) return 0;
  if (typeof value === "string") return value.length;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).length;
  }
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countValueChars(item), 0);
  }
  if (typeof value === "object") {
    // Checked before the recursion, so a media block nested inside a
    // tool_result is charged flat rather than walked down to its base64.
    if (isMediaBlock(value)) return MEDIA_CHARS;
    return Object.entries(value).reduce((total, [key, item]) => {
      return total + key.length + countValueChars(item);
    }, 0);
  }
  return 0;
}

function countContentBlockChars(block) {
  if (block == null) return 0;
  if (typeof block === "string") return block.length;
  if (typeof block !== "object") return countValueChars(block);
  if (isMediaBlock(block)) return MEDIA_CHARS;

  switch (block.type) {
    case "text":
      return countValueChars(block.text);
    case "tool_use":
      return countValueChars(block.name) + countValueChars(block.input);
    case "tool_result":
      return countValueChars(block.content);
    case "thinking":
      return countValueChars(block.thinking);
    default:
      return countValueChars(block);
  }
}

function countMessageChars(message) {
  if (!message || typeof message !== "object") return 0;
  const content = message.content;

  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    return content.reduce((total, block) => total + countContentBlockChars(block), 0);
  }
  return countValueChars(content);
}

export function estimateAnthropicInputTokens(body = {}) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  let totalChars = countValueChars(body.system) + countValueChars(body.tools);

  for (const msg of messages) {
    totalChars += countMessageChars(msg);
  }

  return Math.ceil(totalChars / CHARS_PER_TOKEN);
}

/**
 * POST /v1/messages/count_tokens - Mock token count response
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  const inputTokens = estimateAnthropicInputTokens(body);

  return new Response(JSON.stringify({
    input_tokens: inputTokens
  }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

