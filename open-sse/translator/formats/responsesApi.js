import { ROLE, OPENAI_BLOCK, RESPONSES_ITEM } from "../schema/index.js";
import { sanitizeToolSchema } from "../concerns/toolSchema.js";

// A tool parameter schema can carry a keyword a strict upstream validator rejects
// outright, producing a hard 400 with no tool call at all and nothing the caller
// can do about it from tokenproxy's side. Two are known:
// - a regex `pattern` using lookaround: "Invalid JSON schema: regex lookaround is
//   not supported. Found at $.properties.email.pattern." (#1556)
// - `encrypted: true` on a property, which Codex's multi_agent_v2 subagent tools
//   (spawn_agent.message) declare and a backend not provisioned for OpenAI's
//   encrypted-tool-parameter feature rejects with "declares encrypted parameters
//   but is not configured for encrypted tool use by this model" (#1758).
// Both keywords are metadata the model does not need to honor the tool contract:
// dropping `pattern` loosens validation without changing what values are valid,
// and dropping `encrypted` removes a transport annotation, not the parameter
// itself. NEEDS_SCHEMA_STRIP is a cheap pre-check so untouched requests (the
// overwhelming majority) skip the deep clone below.
const LOOKAROUND = /\(\?<?[=!]/;
const NEEDS_SCHEMA_STRIP = /\(\?<?[=!]|"encrypted"\s*:\s*true/;

/**
 * Drop schema keywords a strict upstream validator rejects: a `pattern` using
 * regex lookaround, and a property marked `encrypted: true`. Mutates in place.
 */
export function stripUnsupportedSchemaKeywords(node) {
  if (Array.isArray(node)) {
    for (const item of node) stripUnsupportedSchemaKeywords(item);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (typeof node.pattern === "string" && LOOKAROUND.test(node.pattern)) delete node.pattern;
  if (node.encrypted === true) delete node.encrypted;
  for (const value of Object.values(node)) stripUnsupportedSchemaKeywords(value);
}

/**
 * Normalize a tool parameters schema for forwarding: strip keywords an upstream
 * validator rejects, and ensure an object schema always carries `properties`
 * (required by Codex Responses API). Returns a fresh object when a strip is
 * needed; a combo reuses one request body across providers, so mutating the
 * caller's schema in place would leak the strip to a provider that accepts it.
 */
export function normalizeToolParameters(params) {
  if (!params) return { type: "object", properties: {} };
  let out = params;
  if (NEEDS_SCHEMA_STRIP.test(JSON.stringify(params) || "")) {
    out = JSON.parse(JSON.stringify(params));
    stripUnsupportedSchemaKeywords(out);
  }
  // A nested zero-argument object schema, and a numeric constraint that arrived
  // as a string, fail strict Codex validation exactly like the top-level ones
  // did (#349, #422). Same reference back when nothing needed fixing, which
  // normalizePassthroughToolSchemas relies on to leave a tool untouched.
  return sanitizeToolSchema(out);
}

/**
 * Strip unsupported schema keywords from every declared tool's parameters, for
 * the same-format Responses passthrough where no request translator runs at all
 * (#1758). Tools here use the flat Responses shape ({type,name,parameters}), not
 * Chat Completions' nested {function:{name,parameters}}. A `custom` tool has no
 * `parameters` (it uses `format` instead) and is left alone. Mutates in place;
 * a body with no matching keyword anywhere is untouched (NEEDS_SCHEMA_STRIP
 * pre-check inside normalizeToolParameters short-circuits per tool).
 */
export function normalizePassthroughToolSchemas(body) {
  if (!Array.isArray(body?.tools)) return;
  // Map to a new array/tool wrapper rather than mutating in place: body.tools is the
  // client's own array, and a combo retries the same body against a later provider,
  // so writing through would leak the strip to a provider that accepts the keyword.
  // normalizeToolParameters returns the same reference when nothing needed stripping,
  // so an untouched tool keeps its original identity.
  body.tools = body.tools.map((tool) => {
    if (tool?.type !== OPENAI_BLOCK.FUNCTION || !tool.parameters || typeof tool.parameters !== "object") {
      return tool;
    }
    const parameters = normalizeToolParameters(tool.parameters);
    return parameters === tool.parameters ? tool : { ...tool, parameters };
  });
}

/**
 * Normalize Responses API input to array format.
 * Accepts string or array, returns array of message items.
 * An empty array is treated like an empty string — providers require at least one user
 * message, so we inject a placeholder rather than forwarding an empty messages[].
 * @param {string|Array} input - raw input from Responses API body
 * @returns {Array|null} normalized array or null if invalid
 */
export function normalizeResponsesInput(input) {
  if (typeof input === "string") {
    const text = input.trim() === "" ? "..." : input;
    return [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text }] }];
  }
  if (Array.isArray(input)) {
    // Empty input[] would produce messages:[] which all providers reject (#389)
    if (input.length === 0) {
      return [{ type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "..." }] }];
    }
    return input;
  }
  return null;
}

/**
 * Hoist Codex `additional_tools` input items into the top-level tools[].
 *
 * Codex Responses Lite declares every tool inside an `additional_tools` input
 * item, a shape only the Lite backend accepts. A same-format Responses passthrough
 * forwards that item verbatim, and a standard Responses upstream rejects the whole
 * request with `Unknown parameter: 'input[N].content'`. Hoisting keeps the tools —
 * unwrapping `namespace` groups, which carry no declaration of their own — and
 * leaves the input free of items no upstream but Lite can read.
 * Mutates `body` in place; a body with no such item is untouched.
 */
export function hoistAdditionalTools(body) {
  if (!Array.isArray(body?.input)) return;
  const hoisted = [];
  // Namespaces nest, and the body is client-controlled, so the walk is bounded
  // rather than trusting the client to stop. Codex nests one level.
  const collect = (tools, depth) => {
    if (!Array.isArray(tools) || depth > 8) return;
    for (const tool of tools) {
      if (!tool) continue;
      if (tool.type === RESPONSES_ITEM.TOOL_NAMESPACE) collect(tool.tools, depth + 1);
      else hoisted.push(tool);
    }
  };
  const kept = [];
  for (const item of body.input) {
    if (item?.type === RESPONSES_ITEM.ADDITIONAL_TOOLS) collect(item.tools, 0);
    else kept.push(item);
  }
  if (kept.length === body.input.length) return;
  body.input = kept;
  if (hoisted.length > 0) {
    body.tools = [...(Array.isArray(body.tools) ? body.tools : []), ...hoisted];
  }
}

/**
 * Type every role-bearing item in a Responses `input[]`.
 *
 * The backend matches each item against the input union on its `type`, and an
 * item carrying only `{ role, content }` matches nothing — it is rejected with
 * `Unknown parameter: 'input[0].content'` (#3390) because the shape it fell
 * back to has no `content` field. Producers that append a turn to an input
 * array already built (combo's judge turn, a request built by a client that
 * omits the field, as Droid CLI does) emit that untyped shape, and the
 * same-format Responses passthrough runs no translator that would repair it.
 *
 * `role` without `type` means a message everywhere else in this tree, so make
 * that explicit on the wire, and give a typed message the content-part array
 * the item union requires rather than the bare string the chat shape uses.
 * Idempotent: an already-typed item is untouched.
 */
export function typeResponsesInputItems(body) {
  if (!Array.isArray(body?.input)) return;
  for (const item of body.input) {
    if (!item || typeof item !== "object" || Array.isArray(item) || !item.role) continue;
    if (!item.type) item.type = RESPONSES_ITEM.MESSAGE;
    if (item.type !== RESPONSES_ITEM.MESSAGE || typeof item.content !== "string") continue;
    item.content = [{
      type: item.role === ROLE.ASSISTANT ? RESPONSES_ITEM.OUTPUT_TEXT : RESPONSES_ITEM.INPUT_TEXT,
      text: item.content,
    }];
  }
}

/**
 * Convert OpenAI Responses API format to standard chat completions format
 * Responses API uses: { input: [...], instructions: "..." }
 * Chat API uses: { messages: [...] }
 */
export function convertResponsesApiFormat(body) {
  if (!body.input) return body;

  const result = { ...body };
  result.messages = [];

  // Convert instructions to system message
  if (body.instructions) {
    result.messages.push({ role: ROLE.SYSTEM, content: body.instructions });
  }

  // Group items by conversation turn
  let currentAssistantMsg = null;
  let pendingToolCalls = [];
  let pendingToolResults = [];

  const inputItems = normalizeResponsesInput(body.input);
  if (!inputItems) return body;

  for (const item of inputItems) {
    // Determine item type - Droid CLI sends role-based items without 'type' field
    // Fallback: if no type but has role property, treat as message
    const itemType = item.type || (item.role ? RESPONSES_ITEM.MESSAGE : null);

    if (itemType === RESPONSES_ITEM.MESSAGE) {
      // Flush any pending assistant message with tool calls
      if (currentAssistantMsg) {
        result.messages.push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      // Flush pending tool results
      if (pendingToolResults.length > 0) {
        for (const tr of pendingToolResults) {
          result.messages.push(tr);
        }
        pendingToolResults = [];
      }

      // Convert content: input_text → text, output_text → text, input_image → image_url
      const content = Array.isArray(item.content)
        ? item.content.map(c => {
          if (c.type === RESPONSES_ITEM.INPUT_TEXT) return { type: OPENAI_BLOCK.TEXT, text: c.text };
          if (c.type === RESPONSES_ITEM.OUTPUT_TEXT) return { type: OPENAI_BLOCK.TEXT, text: c.text };
          if (c.type === RESPONSES_ITEM.INPUT_IMAGE) {
            const url = c.image_url || c.file_id || "";
            return { type: OPENAI_BLOCK.IMAGE_URL, image_url: { url, detail: c.detail || "auto" } };
          }
          return c;
        })
        : item.content;
      result.messages.push({ role: item.role, content });
    }
    else if (itemType === RESPONSES_ITEM.FUNCTION_CALL) {
      // Start or append to assistant message with tool_calls
      if (!currentAssistantMsg) {
        currentAssistantMsg = {
          role: ROLE.ASSISTANT,
          content: null,
          tool_calls: []
        };
      }
      // Skip items with empty/missing name — upstream APIs reject nameless tool calls (#444)
      if (!item.name || typeof item.name !== "string" || item.name.trim() === "") continue;
      currentAssistantMsg.tool_calls.push({
        id: item.call_id,
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: item.name,
          arguments: item.arguments
        }
      });
    }
    else if (itemType === RESPONSES_ITEM.FUNCTION_CALL_OUTPUT) {
      // Flush assistant message first if exists
      if (currentAssistantMsg) {
        result.messages.push(currentAssistantMsg);
        currentAssistantMsg = null;
      }
      // Add tool result
      pendingToolResults.push({
        role: ROLE.TOOL,
        tool_call_id: item.call_id,
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output)
      });
    }
    else if (itemType === RESPONSES_ITEM.REASONING) {
      // Skip reasoning items - they are for display only
      continue;
    }
  }

  // Flush remaining
  if (currentAssistantMsg) {
    result.messages.push(currentAssistantMsg);
  }
  if (pendingToolResults.length > 0) {
    for (const tr of pendingToolResults) {
      result.messages.push(tr);
    }
  }

  // Cleanup Responses API specific fields
  delete result.input;
  delete result.instructions;
  delete result.include;
  delete result.prompt_cache_key;
  delete result.store;
  delete result.reasoning;

  return result;
}
