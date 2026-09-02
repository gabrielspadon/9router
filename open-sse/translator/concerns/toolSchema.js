// Two JSON Schema shapes reach us verbatim from MCP servers and hand-written
// tool declarations, and strict OpenAI/Codex function validation rejects the
// whole tool list rather than ignoring either one:
//
//   - an object schema with no `properties`, which a zero-argument tool
//     declares as exactly `{ type: "object" }` — "object schema missing
//     properties" (#349). The existing normalizers only ever fixed the TOP
//     level, so the same shape nested inside a larger schema still failed.
//   - a numeric keyword whose value arrived as a string, e.g.
//     `{ "maxLength": "64" }` (#422).
//
// Nothing here mutates what it is given: a combo hands the SAME body to each
// member in turn. An unchanged node comes back by reference, so a caller can
// test identity to decide whether anything happened at all.

// Keywords whose value must be a number. exclusiveMinimum/exclusiveMaximum are
// booleans in draft-4, so only a string that parses as finite is converted and
// every other value is left exactly as it arrived.
const NUMERIC_KEYWORDS = new Set([
  "minLength", "maxLength", "minItems", "maxItems", "minContains", "maxContains",
  "minProperties", "maxProperties", "minimum", "maximum",
  "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
]);

// Where child schemas live. Listed explicitly rather than walking every nested
// object, so `default`, `const`, `enum` and `examples` — which hold DATA that
// can look exactly like a schema — are never rewritten.
const SCHEMA_MAPS = ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"];
const SCHEMA_LISTS = ["anyOf", "oneOf", "allOf", "prefixItems"];
const SCHEMA_VALUES = ["items", "additionalProperties", "propertyNames", "contains", "not", "if", "then", "else"];

function toFiniteNumber(value) {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sanitizeList(list) {
  if (!Array.isArray(list)) return list;
  let changed = false;
  const out = list.map(entry => {
    const next = sanitizeToolSchema(entry);
    if (next !== entry) changed = true;
    return next;
  });
  return changed ? out : list;
}

function sanitizeMap(map) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return map;
  let changed = false;
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    out[key] = sanitizeToolSchema(value);
    if (out[key] !== value) changed = true;
  }
  return changed ? out : map;
}

// Normalize one JSON Schema node and everything below it.
export function sanitizeToolSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;

  let out = schema;
  const set = (key, value) => {
    if (out[key] === value) return;
    if (out === schema) out = { ...schema };
    out[key] = value;
  };

  for (const [key, value] of Object.entries(schema)) {
    if (NUMERIC_KEYWORDS.has(key)) {
      const parsed = toFiniteNumber(value);
      if (parsed !== undefined) set(key, parsed);
    } else if (SCHEMA_MAPS.includes(key)) {
      set(key, sanitizeMap(value));
    } else if (SCHEMA_LISTS.includes(key)) {
      set(key, sanitizeList(value));
    } else if (SCHEMA_VALUES.includes(key)) {
      // `items` also takes the tuple form; `additionalProperties` is often a boolean.
      set(key, Array.isArray(value) ? sanitizeList(value) : sanitizeToolSchema(value));
    }
  }

  if (out.type === "object" && (!out.properties || typeof out.properties !== "object")) {
    set("properties", {});
  }

  return out;
}

// One OpenAI function declaration, made safe for a strict validator.
export function sanitizeOpenAIFunction(fn) {
  if (!fn || typeof fn !== "object") return fn;

  const parameters = !fn.parameters || typeof fn.parameters !== "object" || Array.isArray(fn.parameters)
    ? { type: "object", properties: {} }
    : sanitizeToolSchema(fn.parameters);
  // Only an EXISTING non-string description is coerced. Inventing an empty one
  // for a tool that never declared it would change the wire shape every
  // provider sees, to fix a case that is not broken.
  const needsDescription = "description" in fn && typeof fn.description !== "string";

  if (parameters === fn.parameters && !needsDescription) return fn;
  const out = { ...fn, parameters };
  if (needsDescription) out.description = String(fn.description ?? "");
  return out;
}
