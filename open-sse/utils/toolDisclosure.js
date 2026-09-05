/**
 * Progressive tool disclosure: BM25-based, session-sticky tool selection.
 *
 * Maintains a session-level index (keyed by the session key chatCore passes:
 * connection plus client session id) so schemas are parsed and tokenized
 * once per session, not once per turn. The index is rebuilt only when the
 * tool name set changes; the disclosed list survives that rebuild.
 *
 * Config shape:
 *   maxTools   number  – top-K tools to keep after scoring (default 20)
 *   minScore   number  – BM25 score floor (strict >); 0.0 requires at least one matching token (default)
 *   alwaysInclude string[] – tool names never filtered (merged with pinned set)
 */

import { getToolName } from "./toolDeduper.js";

// BM25 tuning constants (Okapi BM25 standard defaults)
const K1 = 1.5;
const B = 0.75;

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "it", "in", "on", "at", "to", "for", "of", "and",
  "or", "but", "with", "from", "by", "as", "this", "that", "can", "will",
  "be", "are", "was", "were", "has", "have", "had", "do", "does", "did",
  "not", "no", "if", "its", "your", "my", "get", "set", "use", "via",
]);

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function getDocText(tool) {
  const name = getToolName(tool);
  const desc = tool?.description || tool?.function?.description || "";
  const schema = tool?.input_schema || tool?.function?.parameters || {};
  const paramNames = Object.keys(schema?.properties || {});

  // Split mcp__server__tool_name into component words; repeat name tokens for weight.
  const nameParts = name.replace(/^mcp__[^_]+__/, "").split(/_+/).filter(Boolean);
  const serverParts = name.match(/^mcp__([^_]+)__/)?.[1]?.split(/_+/) || [];

  return [
    ...nameParts, ...nameParts, ...nameParts,
    ...serverParts,
    desc,
    ...paramNames,
  ].join(" ");
}

function buildIndex(tools) {
  const docs = tools.map((tool, i) => {
    const tokens = tokenize(getDocText(tool));
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    return { i, tf, dl: tokens.length };
  });

  const df = {};
  for (const doc of docs) {
    for (const term of Object.keys(doc.tf)) df[term] = (df[term] || 0) + 1;
  }

  const N = docs.length;
  const avgdl = N ? docs.reduce((s, d) => s + d.dl, 0) / N : 1;

  return { docs, df, N, avgdl };
}

function bm25Scores(index, queryTokens) {
  const { docs, df, N, avgdl } = index;
  const scores = new Array(N).fill(0);

  for (const term of queryTokens) {
    const docFreq = df[term] || 0;
    if (docFreq === 0) continue;
    const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);

    for (const doc of docs) {
      const tf = doc.tf[term] || 0;
      if (tf === 0) continue;
      scores[doc.i] += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * doc.dl / avgdl));
    }
  }

  return scores;
}

function getToolSetId(tools) {
  return tools.map(getToolName).sort().join("|");
}

function extractLastUserMessage(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((b) => b?.type === "text" || typeof b?.text === "string")
        .map((b) => b.text || "")
        .join(" ");
    }
  }
  return "";
}

function extractPinnedNames(body, alwaysInclude = [], tools = []) {
  const pinned = new Set(alwaysInclude);
  pinned.add("ToolSearch"); // Claude Code harness deferred-schema mechanism
  // A client's native tools (anything not namespaced mcp__server__name) are
  // the ones the model calls on nearly every turn, and their schemas are
  // small. Leaving them to the relevance pick meant the first Bash or Read
  // call appended the tool to the disclosed list, and every append rewrites
  // the whole cached prefix (measured live: 7 of 18 turns re-primed).
  // Disclosure trims the MCP catalogue, which is where the bulk is.
  for (const t of tools) {
    const n = getToolName(t);
    if (n && !n.startsWith("mcp__")) pinned.add(n);
  }

  for (const msg of body?.messages || []) {
    // OpenAI format
    for (const tc of msg?.tool_calls || []) {
      const n = tc?.function?.name || tc?.name;
      if (n) pinned.add(n);
    }
    // Claude format
    for (const block of Array.isArray(msg?.content) ? msg.content : []) {
      if (block?.type === "tool_use" && block.name) pinned.add(block.name);
    }
  }

  // Forced tool_choice
  const forced = body?.tool_choice?.name || body?.tool_choice?.function?.name;
  if (forced) pinned.add(forced);

  return pinned;
}

// Session cache: sessionKey → { toolSetId, index, tools, lastSeen, disclosed, selected }
const _cache = new Map();
const MAX_CACHE_SIZE = 500;
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function pruneCache() {
  if (_cache.size < MAX_CACHE_SIZE) return;
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const [k, v] of _cache) {
    if (v.lastSeen < cutoff) _cache.delete(k);
  }
  // If still too large, evict oldest half. Map iterates in insertion order
  // so the first entries are the oldest — no sort needed.
  if (_cache.size >= MAX_CACHE_SIZE) {
    const evictCount = Math.floor(_cache.size / 2);
    let n = 0;
    for (const k of _cache.keys()) {
      if (n++ >= evictCount) break;
      _cache.delete(k);
    }
  }
}

function getOrBuildEntry(sessionKey, tools) {
  const toolSetId = getToolSetId(tools);
  const cached = _cache.get(sessionKey);
  if (cached && cached.toolSetId === toolSetId) {
    cached.lastSeen = Date.now();
    return cached;
  }
  pruneCache();
  // A catalogue change mid-session (a client that loads a deferred schema)
  // rebuilds the index but keeps what the session already disclosed: those
  // tools are in the provider's cached prefix and dropping them would
  // rewrite it.
  const entry = {
    toolSetId,
    index: buildIndex(tools),
    tools,
    lastSeen: Date.now(),
    disclosed: cached?.disclosed || [],
    selected: cached?.selected || false,
  };
  _cache.set(sessionKey, entry);
  return entry;
}

/**
 * Select the tools a turn sees. Session-sticky and append-only.
 *
 * Anthropic hashes the prompt prefix in the order tools, system, messages,
 * so a tool list that differs from the previous request by one entry
 * invalidates the cache for the ENTIRE prompt. Re-running BM25 on every
 * turn against that turn's user message did exactly that: measured on a
 * 64-tool session, every turn reordered 15-23 names and dropped up to 16,
 * and on the live gateway an 800k-token session paid a full cache re-prime
 * per request. So the relevance selection runs ONCE per session, on its
 * first request, and after that the disclosed list only ever grows: a tool
 * the history has called or a forced tool_choice names is appended, nothing
 * is removed, and the order never changes. A session that starts with a
 * weak query discloses fewer tools and keeps that room for pinned additions
 * rather than topping up with later, cache-breaking BM25 picks.
 *
 * Returns { tools: Tool[], stats: { before, after, stripped } | null }
 * Returns stats=null when no filtering occurred (pass-through).
 */
export function disclosureTools(tools, body, sessionKey, config = {}) {
  if (!Array.isArray(tools) || tools.length === 0) return { tools, stats: null };

  const maxTools = config.maxTools ?? 20;
  const minScore = config.minScore ?? 0.0;
  const alwaysInclude = config.alwaysInclude || [];

  if (tools.length <= maxTools) return { tools, stats: null };

  if (!sessionKey) {
    // No session anchor — return first maxTools, respecting pinned
    const pinned = extractPinnedNames(body, alwaysInclude, tools);
    const pinnedTools = tools.filter((t) => pinned.has(getToolName(t)));
    const rest = tools.filter((t) => !pinned.has(getToolName(t)));
    const selected = [...pinnedTools, ...rest].slice(0, maxTools);
    const stats = { before: tools.length, after: selected.length, stripped: tools.length - selected.length };
    _recordStats({ connectionId: "no-session", ...stats });
    return { tools: selected, stats };
  }

  const entry = getOrBuildEntry(sessionKey, tools);
  const byName = new Map(tools.map((t) => [getToolName(t), t]));
  const pinned = extractPinnedNames(body, alwaysInclude, tools);

  // 1. Everything this session already disclosed, in the order it was
  //    disclosed, minus tools the catalogue no longer carries.
  const names = entry.disclosed.filter((n) => byName.has(n));
  const have = new Set(names);
  // 2. Pinned tools the list does not hold yet, appended (a called tool has
  //    to stay visible whatever the cap says).
  for (const n of pinned) if (byName.has(n) && !have.has(n)) { names.push(n); have.add(n); }
  // 3. The one-time relevance pick, on the session's first request only.
  let added = 0;
  if (!entry.selected) {
    entry.selected = true;
    const budget = Math.max(0, maxTools - names.length);
    const candidates = [];
    for (let i = 0; i < tools.length; i++) {
      if (!have.has(getToolName(tools[i]))) candidates.push({ tool: tools[i], i });
    }
    const queryTokens = tokenize(extractLastUserMessage(body));
    let topK;
    if (queryTokens.length === 0) {
      topK = candidates.slice(0, budget);
    } else {
      const scores = bm25Scores(entry.index, queryTokens);
      candidates.sort((a, b) => (scores[b.i] || 0) - (scores[a.i] || 0));
      topK = candidates.filter((c) => (scores[c.i] || 0) > minScore).slice(0, budget);
    }
    for (const c of topK) { names.push(getToolName(c.tool)); added++; }
  }
  entry.disclosed = names;

  const selected = names.map((n) => byName.get(n));
  const strippedSet = new Set(names);
  const stats = {
    before: tools.length,
    after: selected.length,
    stripped: tools.length - selected.length,
    added,
    keptNames: names.slice(),
    strippedNames: tools.filter((t) => !strippedSet.has(getToolName(t))).map(getToolName),
  };
  _recordStats({ connectionId: sessionKey, ...stats });
  return { tools: selected, stats };
}

// --- Recent stats ring buffer (last 50 turns) ---
const _recentStats = [];
const STATS_MAX = 50;

function _recordStats(entry) {
  _recentStats.unshift({ ts: Date.now(), ...entry });
  if (_recentStats.length > STATS_MAX) _recentStats.length = STATS_MAX;
}

export function getRecentStats() {
  return _recentStats.slice();
}

// Exported for tests only
export { buildIndex, bm25Scores, tokenize, extractPinnedNames, extractLastUserMessage, _cache, _recentStats };
