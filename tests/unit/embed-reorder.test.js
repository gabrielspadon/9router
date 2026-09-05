import { describe, it, expect, vi, afterEach } from "vitest";
import { reorderByRelevance } from "../../open-sse/utils/embedReorder.js";

const OPTS = {
  query: "whale song frequency analysis",
  embedUrl: "http://embed.test/v1/embeddings",
  embedModel: "test-embed",
  keepRecentTurns: 2,
};

function keywordVec(text) {
  if (text.includes("whale")) return [0.95, 0.05, 0];
  if (text.includes("bird")) return [0.02, 0.98, 0];
  if (text.includes("fish")) return [0.01, 0.99, 0.1];
  return [0.5, 0.5, 0.5];
}

function embedOk(vecFn = keywordVec) {
  return vi.fn(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: body.input.map((text, index) => ({ index, embedding: vecFn(text) })),
      }),
    };
  });
}

function deepFreeze(obj) {
  if (obj && typeof obj === "object") {
    for (const v of Object.values(obj)) deepFreeze(v);
    Object.freeze(obj);
  }
  return obj;
}

const TAIL = [
  { role: "user", content: "current question" },
  { role: "assistant", content: "tail answer" },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reorderByRelevance", () => {
  it("orders most relevant turns nearest to the tail boundary", async () => {
    const messages = deepFreeze([
      { role: "user", content: "whale song frequency research" },
      { role: "assistant", content: "whale songs carry across ocean basins" },
      { role: "user", content: "bird migration routes" },
      { role: "assistant", content: "birds migrate seasonally" },
      ...TAIL,
    ]);
    const fetchMock = embedOk();
    vi.stubGlobal("fetch", fetchMock);

    const res = await reorderByRelevance(messages, OPTS);

    expect(res.error).toBeUndefined();
    expect(res.messages).not.toBe(messages);
    expect(res.messages.slice(0, 4)).toEqual([
      messages[2],
      messages[3],
      messages[0],
      messages[1],
    ]);
    expect(res.messages[4]).toBe(messages[4]);
    expect(res.messages[5]).toBe(messages[5]);
    expect(res.moved).toBe(4);
    expect(res.notes[0].turn).toBe(2);
    expect(res.notes[0].similarity).toBeCloseTo(1, 3);
    expect(res.notes).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(req.model).toBe("test-embed");
    expect(req.input[0]).toBe(OPTS.query);
    expect(req.input).toHaveLength(5);
  });

  it("truncates notes beyond 5 moved entries", async () => {
    const messages = deepFreeze([
      { role: "user", content: "whale a" },
      { role: "assistant", content: "whale b" },
      { role: "user", content: "whale c" },
      { role: "assistant", content: "bird a" },
      { role: "user", content: "bird b" },
      { role: "assistant", content: "bird c" },
      { role: "user", content: "bird d" },
      ...TAIL,
    ]);
    vi.stubGlobal("fetch", embedOk());

    const res = await reorderByRelevance(messages, OPTS);

    expect(res.moved).toBe(7);
    expect(res.notes).toHaveLength(6);
    expect(res.notes[5]).toEqual({ notesTruncated: true });
  });

  it("pins tool-bearing entries and reorders segments independently", async () => {
    const pinned = {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: "data" }],
    };
    const messages = deepFreeze([
      { role: "user", content: "whale song frequency research" },
      { role: "assistant", content: "whale songs carry far" },
      pinned,
      { role: "user", content: "bird migration notes" },
      { role: "assistant", content: "birds migrate south" },
      ...TAIL,
    ]);
    vi.stubGlobal("fetch", embedOk());

    const res = await reorderByRelevance(messages, OPTS);

    expect(res.error).toBeUndefined();
    expect(res.messages[2]).toBe(pinned);
    // both whale entries outrank both bird entries, but the pinned entry
    // prevents bird entries from crossing into the whale segment
    expect(res.messages.slice(0, 2)).toEqual([messages[0], messages[1]]);
    expect(res.messages.slice(3, 5)).toEqual([messages[3], messages[4]]);
    expect(res.moved).toBe(0);
    expect(res.messages).toBe(messages);
  });

  it("reorders within a segment on both sides of a pinned entry", async () => {
    const pinned = {
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "lookup", input: {} }],
    };
    const vec = (text) =>
      text.includes("whale") ? [0.95, 0.05, 0] : [0.02, 0.98, 0];
    const messages = deepFreeze([
      { role: "assistant", content: "whale song detail" },
      { role: "user", content: "bird watching notes" },
      pinned,
      { role: "user", content: "bird feeding habits" },
      { role: "assistant", content: "whale migration paths" },
      ...TAIL,
    ]);
    vi.stubGlobal("fetch", embedOk(vec));

    const res = await reorderByRelevance(messages, OPTS);

    expect(res.messages[2]).toBe(pinned);
    expect(res.messages[0]).toBe(messages[1]);
    expect(res.messages[1]).toBe(messages[0]);
    expect(res.messages[3]).toBe(messages[3]);
    expect(res.messages[4]).toBe(messages[4]);
    expect(res.moved).toBe(2);
  });

  it("never moves the protected tail even when it scores highest", async () => {
    const messages = deepFreeze([
      { role: "assistant", content: "whale song detail" },
      { role: "user", content: "bird migration notes" },
      { role: "user", content: "fish scale composition" },
      { role: "user", content: "whale song tail question" },
      { role: "assistant", content: "whale song tail answer" },
    ]);
    vi.stubGlobal("fetch", embedOk());

    const res = await reorderByRelevance(messages, OPTS);

    expect(res.messages.slice(3)).toEqual([messages[3], messages[4]]);
    expect(res.messages.slice(0, 3)).toEqual([
      messages[2],
      messages[1],
      messages[0],
    ]);
    expect(res.moved).toBe(2);
  });

  it("fails open on HTTP 500", async () => {
    const messages = deepFreeze([
      { role: "user", content: "whale song" },
      { role: "assistant", content: "bird song" },
      ...TAIL,
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    );
    const res = await reorderByRelevance(messages, OPTS);
    expect(res).toEqual({
      messages,
      moved: 0,
      notes: [],
      error: "embed http 500",
    });
  });

  it("fails open on timeout", async () => {
    const messages = deepFreeze([
      { role: "user", content: "whale song" },
      { role: "assistant", content: "bird song" },
      ...TAIL,
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("timed out", "TimeoutError");
      })
    );
    const res = await reorderByRelevance(messages, OPTS);
    expect(res.messages).toBe(messages);
    expect(res.moved).toBe(0);
    expect(res.error).toBe("timed out");
  });

  it("fails open on malformed response", async () => {
    const messages = deepFreeze([
      { role: "user", content: "whale song" },
      { role: "assistant", content: "bird song" },
      ...TAIL,
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    );
    const res = await reorderByRelevance(messages, OPTS);
    expect(res.messages).toBe(messages);
    expect(res.moved).toBe(0);
    expect(res.error).toBe("embed malformed response");
  });

  it("fails open on zero vectors", async () => {
    const messages = deepFreeze([
      { role: "user", content: "whale song" },
      { role: "assistant", content: "bird song" },
      ...TAIL,
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, opts) => {
        const body = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: body.input.map((_, index) => ({ index, embedding: [0, 0, 0] })),
          }),
        };
      })
    );
    const res = await reorderByRelevance(messages, OPTS);
    expect(res.messages).toBe(messages);
    expect(res.moved).toBe(0);
    expect(res.error).toBe("embed zero vector");
  });

  it("skips the fetch entirely on full cache hit", async () => {
    const messages = deepFreeze([
      { role: "user", content: "whale song research" },
      { role: "assistant", content: "bird migration notes" },
      ...TAIL,
    ]);
    const cache = new Map();
    const fetchMock = embedOk();
    vi.stubGlobal("fetch", fetchMock);

    const first = await reorderByRelevance(messages, { ...OPTS, cache });
    const callsAfterFirst = fetchMock.mock.calls.length;
    const second = await reorderByRelevance(messages, { ...OPTS, cache });

    expect(first.moved).toBe(2);
    expect(second.moved).toBe(2);
    expect(second.messages).toEqual(first.messages);
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterFirst);
  });

  it("passes through on short queries without fetching", async () => {
    const messages = [{ role: "user", content: "whale song" }];
    const fetchMock = embedOk();
    vi.stubGlobal("fetch", fetchMock);
    const res = await reorderByRelevance(messages, { ...OPTS, query: "hi there" });
    expect(res.messages).toBe(messages);
    expect(res.moved).toBe(0);
    expect(res.notes).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes through when no movable run reaches length 2", async () => {
    const messages = deepFreeze([
      { role: "user", content: "whale song" },
      { role: "user", content: "bird song" },
    ]);
    const fetchMock = embedOk();
    vi.stubGlobal("fetch", fetchMock);
    const res = await reorderByRelevance(messages, { ...OPTS, keepRecentTurns: 1 });
    expect(res.messages).toBe(messages);
    expect(res.moved).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles empty input", async () => {
    const fetchMock = embedOk();
    vi.stubGlobal("fetch", fetchMock);
    const res = await reorderByRelevance([], OPTS);
    expect(res.messages).toEqual([]);
    expect(res.moved).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
