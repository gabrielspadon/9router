import { describe, it, expect, beforeEach } from "vitest";
import { reorderByRelevance } from "../../open-sse/utils/embedReorder.js";

// embedReorder's sort key is cosine similarity alone (open-sse/utils/embedReorder.js,
// reorderByRelevance): each movable run is a fixed set of ARRAY POSITIONS whose role
// alternates by original parity, but the CONTENT dropped into those positions is
// picked purely by similarity rank, with role never consulted. When a run holds
// several same-role entries (every user turn here shares that role with every other
// user turn), two of them can rank adjacent by similarity and land in adjacent
// output slots, producing role-repeat, or a user turn can outrank the assistant
// turn that originally answered it and get moved past it. This test builds exactly
// that case with a deterministic bag-of-words mock embedding.

const BUCKETS = 16;

function hashWord(word) {
  let h = 0;
  for (const c of word) h = (h * 31 + c.charCodeAt(0)) % BUCKETS;
  return h;
}

function embed(text) {
  const vec = new Array(BUCKETS).fill(0);
  const words = String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const w of words) vec[hashWord(w)] += 1;
  return vec;
}

function stubEmbeddings() {
  globalThis.fetch = async (_url, opts) => {
    const { input } = JSON.parse(opts.body);
    return new Response(
      JSON.stringify({ data: input.map((t, i) => ({ index: i, embedding: embed(t) })) }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

// 8 alternating text-only history turns (indices 0-7) plus a final live user
// query (index 8, kept out of the movable region by keepRecentTurns: 1). The
// two "gizmo" user turns (0 and 2) score highest against the query; every
// other turn shares no words with it and scores exactly 0.
function buildMessages() {
  return [
    { role: "user", content: "gizmo gizmo gizmo widget" },
    { role: "assistant", content: "widget widget widget" },
    { role: "user", content: "gizmo gizmo sprocket" },
    { role: "assistant", content: "sprocket sprocket sprocket" },
    { role: "user", content: "cog cog cog" },
    { role: "assistant", content: "leverx leverx leverx" },
    { role: "user", content: "spring spring spring" },
    { role: "assistant", content: "bolt bolt bolt" },
    { role: "user", content: "gizmo gizmo gizmo" },
  ];
}

describe("reorderByRelevance role alternation", () => {
  let messages;
  let out;

  beforeEach(async () => {
    stubEmbeddings();
    messages = buildMessages();
    const res = await reorderByRelevance(messages, {
      query: "gizmo gizmo gizmo",
      embedUrl: "http://mock/embeddings",
      embedModel: "test-model",
      keepRecentTurns: 1,
      cache: new Map(),
    });
    out = res.messages;
  });

  it("never places two consecutive entries with the same role", () => {
    const roleRepeats = [];
    for (let i = 1; i < out.length; i++) {
      if (out[i].role === out[i - 1].role) roleRepeats.push(i);
    }
    expect(roleRepeats).toEqual([]);
  });

  it("keeps every user entry immediately followed by its original answer", () => {
    for (let i = 0; i < messages.length - 1; i++) {
      if (messages[i].role !== "user" || messages[i + 1].role !== "assistant") continue;
      const pos = out.indexOf(messages[i]);
      expect(out[pos + 1]).toBe(messages[i + 1]);
    }
  });
});
