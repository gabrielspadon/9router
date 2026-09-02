// Reversible PII pseudonymisation for outbound request bodies (#2728).
//
// One filter instance owns one request. It rewrites email addresses (and any
// operator-supplied literal terms) in message content to stable aliases before
// the body leaves for the provider, and turns the aliases back into the real
// values on the way out, so the client agent never sees the substitution.
//
// Aliases land in the RFC 2606 reserved `.invalid` TLD, which no real address
// can occupy, so restoration can never collide with genuine content.
//
// Fail-open, same contract as open-sse/rtk: an error leaves the body untouched
// rather than failing the request. Privacy is a preference here, not a boundary
// — a model that paraphrases an alias instead of echoing it defeats the
// round-trip, and nothing downstream can detect that.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ALIAS_DOMAIN = "redacted.invalid";

// Keys whose string values are model-visible prose. Everything else (ids,
// roles, types, tool_call_id) is protocol and must survive byte-identical.
const CONTENT_KEYS = new Set(["text", "content", "output", "input_text", "system"]);
const MAX_DEPTH = 12;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createPrivacyFilter({ emails = true, terms = [] } = {}) {
  const toAlias = new Map(); // original -> alias
  const toOriginal = new Map(); // alias -> original
  let seq = 0;

  // Longest first: a term that contains another must be matched before it.
  const literals = [...new Set(terms.filter((t) => typeof t === "string" && t.trim()))].sort(
    (a, b) => b.length - a.length,
  );
  const literalRe = literals.length
    ? new RegExp(literals.map(escapeRe).join("|"), "g")
    : null;

  function alias(original, emailShaped) {
    let a = toAlias.get(original);
    if (a) return a;
    seq += 1;
    a = emailShaped ? `p${seq}@${ALIAS_DOMAIN}` : `[redacted-${seq}]`;
    toAlias.set(original, a);
    toOriginal.set(a, original);
    return a;
  }

  function redactText(text) {
    if (typeof text !== "string" || !text) return text;
    let out = text;
    if (literalRe) out = out.replace(literalRe, (m) => alias(m, false));
    if (emails) out = out.replace(EMAIL_RE, (m) => (m.endsWith(ALIAS_DOMAIN) ? m : alias(m, true)));
    return out;
  }

  function replaceAliases(text, escape) {
    if (typeof text !== "string" || !text || toOriginal.size === 0) return text;
    let out = text;
    // Longest alias first so `[redacted-1]` never eats `[redacted-12]`.
    for (const a of aliases()) out = out.split(a).join(escape(toOriginal.get(a)));
    return out;
  }

  function restore(text) {
    return replaceAliases(text, (v) => v);
  }

  // Restore into text that is itself JSON (a serialised response body, an SSE
  // `data:` frame, or the JSON string a tool call carries as `arguments`). The
  // alias is plain ASCII so it always appears literally, but the original it
  // gives way to may contain a quote, a backslash or a newline, and dropping
  // that in raw would corrupt the document around it.
  function restoreJson(text) {
    return replaceAliases(text, (v) => JSON.stringify(v).slice(1, -1));
  }

  function aliases() {
    return [...toOriginal.keys()].sort((a, b) => b.length - a.length);
  }

  // Walk only the content-bearing keys, so ids and roles cannot be rewritten.
  function walk(node, depth, inContent) {
    if (depth > MAX_DEPTH || node == null) return node;
    if (typeof node === "string") return inContent ? redactText(node) : node;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) node[i] = walk(node[i], depth + 1, inContent);
      return node;
    }
    if (typeof node !== "object") return node;
    for (const key of Object.keys(node)) {
      node[key] = walk(node[key], depth + 1, inContent || CONTENT_KEYS.has(key));
    }
    return node;
  }

  return {
    /**
     * Rewrite message content in place. Returns the number of distinct values
     * pseudonymised, or null when nothing was done.
     */
    redactBody(body) {
      try {
        if (!body || typeof body !== "object") return null;
        for (const field of ["messages", "input", "system"]) {
          if (body[field] != null) body[field] = walk(body[field], 0, field === "system");
        }
        return toOriginal.size || null;
      } catch {
        return null;
      }
    },
    redactText,
    restore,
    restoreJson,
    aliases,
    get size() {
      return toOriginal.size;
    },
  };
}

/**
 * Streaming-safe restorer. An alias split across two SSE chunks would survive a
 * naive per-chunk replace unrestored, so the tail is held back only while it is
 * still a viable prefix of some alias — a chunk that cannot be mid-alias is
 * emitted with no added latency.
 */
export function createRestorer(filter, { json = false } = {}) {
  const put = (text) => (json ? filter.restoreJson(text) : filter.restore(text));
  let carry = "";
  return {
    push(chunk) {
      try {
        const buf = carry + String(chunk ?? "");
        const list = filter.aliases();
        let cut = buf.length;
        for (const a of list) {
          for (let k = Math.min(a.length - 1, buf.length); k > 0; k--) {
            if (buf.endsWith(a.slice(0, k))) {
              cut = Math.min(cut, buf.length - k);
              break;
            }
          }
        }
        carry = buf.slice(cut);
        return put(buf.slice(0, cut));
      } catch {
        const out = carry + String(chunk ?? "");
        carry = "";
        return out;
      }
    },
    flush() {
      const out = put(carry);
      carry = "";
      return out;
    },
  };
}

/**
 * Redact a body about to be dispatched. Returns the filter that holds the
 * mapping, or null when nothing was pseudonymised — null means the response
 * path has nothing to restore and skips itself entirely.
 */
export function redactOutbound(body, terms) {
  try {
    const filter = createPrivacyFilter({ terms });
    return filter.redactBody(body) ? filter : null;
  } catch {
    return null;
  }
}

/**
 * Response half, non-streaming. Same string on the off path (no filter, or a
 * filter that mapped nothing), so a disabled request pays one truthiness check.
 */
export function restoreResponseJson(filter, json) {
  if (!filter?.size) return json;
  try {
    return filter.restoreJson(json);
  } catch {
    return json;
  }
}

/**
 * Response half, streaming. Splices a restoring transform into the SSE byte
 * stream, so an alias is put back even when it straddles two chunks and even
 * when it sits inside a tool call's `arguments` string. Same stream object on
 * the off path.
 */
export function restoreResponseStream(filter, stream) {
  if (!filter?.size) return stream;
  const restorer = createRestorer(filter, { json: true });
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const emit = (controller, text) => {
    if (text) controller.enqueue(encoder.encode(text));
  };
  try {
    return stream.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          try {
            emit(controller, restorer.push(decoder.decode(chunk, { stream: true })));
          } catch {
            controller.enqueue(chunk);
          }
        },
        flush(controller) {
          try {
            emit(controller, restorer.push(decoder.decode()) + restorer.flush());
          } catch {
            /* nothing left worth risking the stream over */
          }
        },
      }),
    );
  } catch {
    return stream;
  }
}
