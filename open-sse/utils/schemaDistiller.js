// Schema distillation token-saver: strips JSON-Schema keywords that carry no
// validation signal for Anthropic/OpenAI tool calling (the upstream validates
// nothing, it only reads name/description/enum/required/property structure),
// and collapses whitespace runs inside input_schema description strings.
//
// Conservative on purpose:
//   - tool.name and tool.description are NEVER touched.
//   - keywords are dropped inside input_schema only, recursively; anything
//     outside input_schema is copied verbatim.
//   - enum / required / additionalProperties / type / items / properties and
//     every other structural keyword survive.
//   - deep copy only: the caller's array is never mutated.
//   - engages only when the serialized tools array is >= MIN_BYTES; below
//     that the rewrite does not pay for itself.

const MIN_BYTES = 8192;
const STRIP_KEYS = new Set(["default", "examples", "example", "$schema", "title"]);

function collapseWs(text) {
  return text.replace(/\s{2,}/g, " ");
}

function distillNode(node, notes) {
  if (Array.isArray(node)) return node.map((n) => distillNode(n, notes));
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (STRIP_KEYS.has(key)) {
      notes.add(`stripped:${key}`);
      continue;
    }
    if (key === "description" && typeof value === "string") {
      const collapsed = collapseWs(value);
      if (collapsed !== value) notes.add("ws:description");
      out[key] = collapsed;
      continue;
    }
    out[key] = distillNode(value, notes);
  }
  return out;
}

/**
 * @param {Array} tools tool array in any of the wire shapes the savers see
 * @returns {{tools: Array, savedBytes: number, notes: string[]}}
 *   tools is a distilled deep copy when the stage engaged and saved bytes,
 *   otherwise the INPUT ARRAY ITSELF (unchanged, savedBytes 0) — callers can
 *   always assign the result, mutation-free by construction.
 */
export function distillToolSchemas(tools) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return { tools, savedBytes: 0, notes: [] };
  }
  const before = JSON.stringify(tools).length;
  if (before < MIN_BYTES) {
    return { tools, savedBytes: 0, notes: [] };
  }
  const notes = new Set();
  const copy = tools.map((tool) => {
    if (!tool || typeof tool !== "object") return tool;
    const { input_schema, inputSchema, ...rest } = tool;
    const out = { ...rest };
    for (const [key, schema] of [["input_schema", input_schema], ["inputSchema", inputSchema]]) {
      if (schema && typeof schema === "object") out[key] = distillNode(schema, notes);
      else if (schema !== undefined) out[key] = schema;
    }
    // Shape-specific schema homes (Responses API / Gemini) get the same
    // treatment: keywords dropped recursively, nothing else touched.
    for (const key of ["parameters", "schema"]) {
      if (tool[key] && typeof tool[key] === "object") out[key] = distillNode(tool[key], notes);
    }
    // OpenAI function shape nests the schema one level deeper; the wrapper's
    // name/description are model-read text and stay verbatim.
    if (tool.function && typeof tool.function === "object") {
      const fn = { ...tool.function };
      for (const key of ["parameters", "schema"]) {
        if (fn[key] && typeof fn[key] === "object") fn[key] = distillNode(fn[key], notes);
      }
      out.function = fn;
    }
    return out;
  });
  const after = JSON.stringify(copy).length;
  const savedBytes = Math.max(0, before - after);
  // Second pass over an already-distilled array must be a fixed point; if a
  // shape quirk made it not one, report honestly instead of looping.
  return { tools: copy, savedBytes, notes: [...notes] };
}
