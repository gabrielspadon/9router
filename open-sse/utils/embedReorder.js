// Embedding-based reordering of historical chat turns (#token-savers).
//
// Within the movable region before the kept-recent tail, whole text-only
// user/assistant turns are reordered by cosine similarity to the current
// user query, most relevant nearest to the tail boundary. Tool-bearing
// entries are pinned anchors: they split the historical region into
// independent segments that are each reordered on their own.
//
// Fail-open, same contract as open-sse/rtk: any embedding failure returns
// the input untouched with an error reason rather than breaking the request.

import { createHash } from "node:crypto";

const CACHE_MAX = 512;
const internalCache = new Map(); // module-level LRU, first-key eviction

const BLOCKED_KEYS = new Set([
  "tool_use",
  "tool_result",
  "function_call",
  "function_call_output",
]);
const ALLOWED_BLOCK_TYPES = new Set(["text", "thinking", "redacted_thinking"]);
const ALNUM_RE = /[a-z0-9]+/gi;

function cacheKey(model, text) {
  return createHash("sha256").update(`${model}:${text}`).digest("hex");
}

function cacheGet(cache, key) {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key);
  // refresh LRU order
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function cacheSet(cache, key, value) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

function isTextOnly(entry) {
  const role = entry && entry.role;
  if (role !== "user" && role !== "assistant") return false;
  const content = entry.content;
  if (typeof content === "string") return true;
  if (!Array.isArray(content)) return false;
  for (const block of content) {
    if (!block || typeof block !== "object") return false;
    if (BLOCKED_KEYS.has(block.type)) return false;
    if (!ALLOWED_BLOCK_TYPES.has(block.type)) return false;
  }
  return true;
}

function extractText(entry) {
  const content = entry.content;
  if (typeof content === "string") return content;
  const parts = [];
  for (const block of content) {
    if (typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function failOpen(messages, reason) {
  return { messages, moved: 0, notes: [], error: reason };
}

async function fetchEmbeddings({ embedUrl, embedModel, input, timeoutMs }) {
  const res = await fetch(embedUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: embedModel, input }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`embed http ${res.status}`);
  const body = await res.json();
  if (!body || !Array.isArray(body.data)) throw new Error("embed malformed response");
  const sorted = [...body.data];
  if (sorted.some((d) => d && typeof d.index === "number")) {
    sorted.sort((x, y) => (x.index || 0) - (y.index || 0));
  }
  const out = sorted.map((d) => {
    if (!d || !Array.isArray(d.embedding)) throw new Error("embed malformed entry");
    return d.embedding;
  });
  if (out.length !== input.length) throw new Error("embed count mismatch");
  const dim = out[0] ? out[0].length : 0;
  if (out.some((e) => !e.length || e.length !== dim)) {
    throw new Error("embed dimension mismatch");
  }
  if (out.some((e) => e.every((v) => v === 0))) {
    throw new Error("embed zero vector");
  }
  return out;
}

export async function reorderByRelevance(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages, moved: 0, notes: [] };
  }
  const { query, embedUrl, embedModel } = options;
  if (
    typeof query !== "string" ||
    !query.trim() ||
    typeof embedUrl !== "string" ||
    !embedUrl ||
    typeof embedModel !== "string" ||
    !embedModel
  ) {
    return failOpen(messages, "missing required options");
  }
  const keepRecentTurns = Number.isFinite(options.keepRecentTurns)
    ? Math.max(0, Math.floor(options.keepRecentTurns))
    : 2;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 4000;
  const cache = options.cache instanceof Map ? options.cache : internalCache;

  const terms = query.match(ALNUM_RE);
  if (!terms || terms.length < 3) {
    return { messages, moved: 0, notes: [] };
  }

  const tailLen = Math.min(keepRecentTurns, messages.length);
  const histLen = messages.length - tailLen;
  const movableFlags = [];
  for (let i = 0; i < histLen; i++) movableFlags[i] = isTextOnly(messages[i]);

  // collect movable runs; require at least one run of length >= 2
  const runs = [];
  let run = null;
  for (let i = 0; i < histLen; i++) {
    if (movableFlags[i]) {
      if (!run) {
        run = [];
        runs.push(run);
      }
      run.push(i);
    } else {
      run = null;
    }
  }
  if (!runs.some((r) => r.length >= 2)) {
    return { messages, moved: 0, notes: [] };
  }

  // gather texts in first-seen order for the batch
  const allIndices = [];
  for (const r of runs) {
    if (r.length >= 2) allIndices.push(...r);
  }
  const texts = allIndices.map((i) => extractText(messages[i]));

  // cache lookup
  const queryKey = cacheKey(embedModel, query);
  const textKeys = texts.map((t) => cacheKey(embedModel, t));
  let queryVec = cacheGet(cache, queryKey);
  const textVecs = textKeys.map((k) => cacheGet(cache, k));
  const missTextIdx = [];
  textVecs.forEach((v, i) => {
    if (v === undefined) missTextIdx.push(i);
  });
  if (queryVec === undefined || missTextIdx.length > 0) {
    const batch = [];
    const slots = [];
    if (queryVec === undefined) {
      slots.push({ key: queryKey, kind: "query" });
      batch.push(query);
    }
    for (const i of missTextIdx) {
      slots.push({ key: textKeys[i], kind: "text", idx: i });
      batch.push(texts[i]);
    }
    let embeddings;
    try {
      embeddings = await fetchEmbeddings({ embedUrl, embedModel, input: batch, timeoutMs });
    } catch (err) {
      return failOpen(
        messages,
        err && err.message ? err.message : "embed request failed"
      );
    }
    for (let s = 0; s < slots.length; s++) {
      cacheSet(cache, slots[s].key, embeddings[s]);
      if (slots[s].kind === "query") queryVec = embeddings[s];
      else textVecs[slots[s].idx] = embeddings[s];
    }
  }

  const simByIndex = new Map();
  for (let i = 0; i < allIndices.length; i++) {
    simByIndex.set(allIndices[i], cosine(queryVec, textVecs[i]));
  }

  // reorder each run independently: reading head to tail, similarity is
  // non-decreasing, so the most relevant turn ends nearest the tail boundary;
  // ties keep original order (ascending stable sort)
  const out = messages.slice();
  const movedInfo = [];
  for (const r of runs) {
    if (r.length < 2) continue;
    const order = r
      .map((idx) => ({ idx, sim: simByIndex.get(idx) }))
      .sort((a, b) => a.sim - b.sim || a.idx - b.idx);
    for (let p = 0; p < r.length; p++) {
      const slot = order[p];
      const origIdx = r[p];
      out[origIdx] = messages[slot.idx];
      if (slot.idx !== origIdx) {
        movedInfo.push({ idx: origIdx, sim: slot.sim });
      }
    }
  }
  if (movedInfo.length === 0) {
    return { messages, moved: 0, notes: [] };
  }
  movedInfo.sort((a, b) => b.sim - a.sim || a.idx - b.idx);
  const top = movedInfo.slice(0, 5);
  const notes = top.map((m) => ({
    turn: m.idx,
    similarity: Math.round(m.sim * 10000) / 10000,
  }));
  if (movedInfo.length > 5) notes.push({ notesTruncated: true });
  return { messages: out, moved: movedInfo.length, notes };
}
