import { describe, it, expect } from "vitest";

import { pruneHistoricalTools } from "../../open-sse/services/memory/toolPruner.js";

const NOTICE_RE =
  /\[\.\.\. Tool output truncated by tokenproxy memory optimizer: \d+ lines \/ \d+ chars omitted \.\.\.\]/;

function toolResult(text, extra = {}) {
  return { role: "tool", tool_call_id: `call_${Math.random().toString(36).slice(2, 8)}`, content: text, ...extra };
}

function bigText(tag, chars = 3000) {
  return `${tag}\n` + "x".repeat(chars) + `\n${tag}-end`;
}

function historyWithToolTurns(n, { chars = 3000, filler = true } = {}) {
  const messages = [];
  for (let i = 0; i < n; i++) {
    if (filler) messages.push({ role: "user", content: `question ${i}` });
    messages.push({ role: "assistant", content: `answer ${i}` });
    messages.push(toolResult(bigText(`tool-output-${i}`, chars)));
  }
  messages.push({ role: "user", content: "current question" });
  return { messages };
}

describe("token-saver tool pruner: keepRecentTurns boundaries", () => {
  it("exactly keepRecentTurns tool turns -> nothing pruned", () => {
    const body = historyWithToolTurns(2);
    const snapshot = JSON.stringify(body.messages);
    const res = pruneHistoricalTools(body, { keepRecentTurns: 2, maxHistoricalChars: 800 });

    expect(res.pruned).toBe(false);
    expect(res.count).toBe(0);
    expect(JSON.stringify(body.messages)).toBe(snapshot);
  });

  it("keepRecentTurns - 1 tool turns -> nothing pruned", () => {
    const body = historyWithToolTurns(1);
    const snapshot = JSON.stringify(body.messages);
    const res = pruneHistoricalTools(body, { keepRecentTurns: 2, maxHistoricalChars: 800 });

    expect(res.pruned).toBe(false);
    expect(JSON.stringify(body.messages)).toBe(snapshot);
  });

  it("keepRecentTurns + 1 tool turns -> exactly the oldest pruned, recent 2 byte-identical", () => {
    const body = historyWithToolTurns(3);
    const recentTwo = body.messages.filter((m) => m.role === "tool").slice(-2);
    const res = pruneHistoricalTools(body, { keepRecentTurns: 2, maxHistoricalChars: 800 });

    expect(res.pruned).toBe(true);
    expect(res.count).toBe(1);
    const toolMsgs = body.messages.filter((m) => m.role === "tool");
    expect(toolMsgs[0].content).toMatch(NOTICE_RE);
    expect(JSON.stringify(toolMsgs.slice(-2))).toBe(JSON.stringify(recentTwo));
  });

  it("keepRecentTurns + 5 tool turns -> oldest 5 pruned, last 2 byte-identical", () => {
    const body = historyWithToolTurns(7);
    const recentTwo = body.messages.filter((m) => m.role === "tool").slice(-2);
    const res = pruneHistoricalTools(body, { keepRecentTurns: 2, maxHistoricalChars: 800 });

    expect(res.count).toBe(5);
    const toolMsgs = body.messages.filter((m) => m.role === "tool");
    for (const m of toolMsgs.slice(0, 5)) expect(m.content).toMatch(NOTICE_RE);
    expect(JSON.stringify(toolMsgs.slice(-2))).toBe(JSON.stringify(recentTwo));
  });

  it("history with NO tool turns -> untouched", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "again" },
      ],
    };
    const snapshot = JSON.stringify(body.messages);
    const res = pruneHistoricalTools(body, { keepRecentTurns: 2, maxHistoricalChars: 800 });

    expect(res.pruned).toBe(false);
    expect(JSON.stringify(body.messages)).toBe(snapshot);
  });

  it("ALL turns are tool turns -> oldest pruned, keepRecentTurns intact", () => {
    const body = { messages: Array.from({ length: 6 }, (_, i) => toolResult(bigText(`t${i}`))) };
    const res = pruneHistoricalTools(body, { keepRecentTurns: 2, maxHistoricalChars: 800 });

    expect(res.count).toBe(4);
    expect(body.messages[0].content).toMatch(NOTICE_RE);
    expect(body.messages[4].content).toBe(bigText("t4"));
    expect(body.messages[5].content).toBe(bigText("t5"));
  });
});

describe("token-saver tool pruner: truncation contract", () => {
  it("pruned text carries exact truncation note and stays within max + notice budget", () => {
    const max = 800;
    const original = bigText("build-log", 6000);
    const body = { messages: [toolResult(original), toolResult(bigText("recent", 3000))] };
    pruneHistoricalTools(body, { keepRecentTurns: 1, maxHistoricalChars: max });

    const pruned = body.messages[0].content;
    expect(pruned).toMatch(NOTICE_RE);
    // head (70%) + tail (30%) + notice: bounded by max plus the explanatory note
    const noticeLen = pruned.match(NOTICE_RE)[0].length;
    expect(pruned.length).toBeLessThanOrEqual(max + noticeLen + 2);
    expect(pruned.length).toBeLessThan(original.length);
  });

  it("short historical tool output is NOT touched (no note appended)", () => {
    const body = { messages: [toolResult("small output"), toolResult(bigText("recent"))] };
    const res = pruneHistoricalTools(body, { keepRecentTurns: 1, maxHistoricalChars: 800 });
    expect(body.messages[0].content).toBe("small output");
    expect(res.count).toBe(0);
  });

  it("NON-tool content in a pruned Claude turn survives verbatim", () => {
    const preservedText = "This human text must survive untouched.";
    const mkTurn = (n, text) => [
      {
        role: "user",
        content: [
          { type: "text", text },
          { type: "tool_result", tool_use_id: `toolu_${n}`, content: bigText(`dump-${n}`, 5000) },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: `done ${n}` }, { type: "tool_use", id: `toolu_${n}`, name: "Read", input: {} }] },
    ];
    const messages = [
      ...mkTurn(1, preservedText),
      ...mkTurn(2, "middle question"),
      ...mkTurn(3, "recent question"),
      { role: "user", content: "current question" },
    ];
    const recentSnapshot = JSON.stringify(messages.slice(2, 6));
    const body = { messages };
    pruneHistoricalTools(body, { keepRecentTurns: 2, maxHistoricalChars: 800 });

    const historical = body.messages[0].content;
    expect(historical[0]).toEqual({ type: "text", text: preservedText });
    expect(historical[1].type).toBe("tool_result");
    expect(historical[1].content).toMatch(NOTICE_RE);
    // assistant tool_use block untouched
    expect(body.messages[1].content[1]).toEqual({ type: "tool_use", id: "toolu_1", name: "Read", input: {} });
    // the 2 most recent tool turns byte-identical
    expect(JSON.stringify(body.messages.slice(2, 6))).toBe(recentSnapshot);
  });
});

function collectPairs(messages) {
  const uses = [];
  const results = [];
  for (const msg of messages) {
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    for (const b of blocks) {
      if (b?.type === "tool_use" && b.id) uses.push(b.id);
      if (b?.type === "tool_result" && b.tool_use_id) results.push(b.tool_use_id);
    }
    if (Array.isArray(msg.tool_calls)) {
      for (const c of msg.tool_calls) if (c?.id) uses.push(c.id);
    }
    if (typeof msg.tool_call_id === "string") results.push(msg.tool_call_id);
    if (msg.type === "function_call" && msg.call_id) uses.push(msg.call_id);
    if (msg.type === "function_call_output" && msg.call_id) results.push(msg.call_id);
  }
  return { uses, results };
}

function expectPairsIntact(messages) {
  const { uses, results } = collectPairs(messages);
  expect(new Set(uses).size).toBe(uses.length);
  expect(new Set(results).size).toBe(results.length);
  for (const id of uses) expect(results).toContain(id);
  for (const id of results) expect(uses).toContain(id);
}

function claudeHistory(turns) {
  // turns: [{toolIds: [...]}] older -> newer; interleaves user(tool_results) / assistant(tool_uses)
  const messages = [];
  for (let t = 0; t < turns; t++) {
    const ids = [`toolu_t${t}a`, `toolu_t${t}b`];
    messages.push({
      role: "user",
      content: [
        { type: "text", text: `result text ${t}` },
        ...ids.map((id) => ({ type: "tool_result", tool_use_id: id, content: bigText(`out-${id}`, 2500) })),
      ],
    });
    messages.push({
      role: "assistant",
      content: [
        { type: "text", text: `analysis ${t}` },
        ...ids.map((id) => ({ type: "tool_use", id, name: "Bash", input: { cmd: String(t) } })),
      ],
    });
  }
  messages.push({ role: "user", content: "current question" });
  return { messages };
}

describe("token-saver tool pruner: pairing invariant", () => {
  it("Claude interleaved multi-tool turns -> no orphaned tool_use/tool_result after pruning", () => {
    const body = claudeHistory(5);
    const res = pruneHistoricalTools(body, { keepRecentTurns: 2, maxHistoricalChars: 800 });
    expect(res.count).toBeGreaterThan(0);
    expectPairsIntact(body.messages);
  });

  it("OpenAI role=tool history -> tool_call_id/tool_calls pairs intact", () => {
    const messages = [];
    for (let t = 0; t < 5; t++) {
      messages.push({ role: "assistant", content: "", tool_calls: [{ id: `call_${t}`, type: "function", function: { name: "f", arguments: "{}" } }] });
      messages.push({ role: "tool", tool_call_id: `call_${t}`, content: bigText(`out-${t}`, 2500) });
    }
    const body = { messages };
    pruneHistoricalTools(body, { keepRecentTurns: 2, maxHistoricalChars: 800 });
    expectPairsIntact(body.messages);
  });

  it("OpenAI Responses function_call/function_call_output pairs intact", () => {
    const messages = [];
    for (let t = 0; t < 5; t++) {
      messages.push({ type: "function_call", call_id: `fc_${t}`, name: "f", arguments: "{}" });
      messages.push({ type: "function_call_output", call_id: `fc_${t}`, output: bigText(`out-${t}`, 2500) });
    }
    const body = { messages };
    pruneHistoricalTools(body, { keepRecentTurns: 2, maxHistoricalChars: 800 });
    expectPairsIntact(body.messages);
  });
});

describe("token-saver tool pruner: evidence and cache metadata", () => {
  it("is_error Claude tool_result blocks are exempt from pruning (evidence contract)", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_err", is_error: true, content: bigText("stack-trace", 5000) },
          ],
        },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_err", name: "Bash", input: {} }] },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_ok", content: bigText("recent", 4000) }],
        },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_ok", name: "Bash", input: {} }] },
      ],
    };
    pruneHistoricalTools(body, { keepRecentTurns: 1, maxHistoricalChars: 800 });
    const block = body.messages[0].content[0];
    expect(block.type).toBe("tool_result");
    expect(block.is_error).toBe(true);
    expect(block.tool_use_id).toBe("toolu_err");
    // exempt blocks stay byte-identical; the truncation notice is NOT added
    expect(block.content).toBe(bigText("stack-trace", 5000));
    expect(block.content).not.toMatch(NOTICE_RE);
  });

  it("cache_control preserved on surviving blocks", () => {
    const body = {
      messages: [
        { role: "system", content: "sys", cache_control: { type: "ephemeral" } },
        {
          role: "user",
          content: [
            { type: "text", text: "recent", cache_control: { type: "ephemeral" } },
            { type: "tool_result", tool_use_id: "toolu_c", content: bigText("recent", 4000), cache_control: { type: "ephemeral" } },
          ],
        },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_c", name: "Bash", input: {} }], cache_control: { type: "ephemeral" } },
      ],
    };
    pruneHistoricalTools(body, { keepRecentTurns: 2, maxHistoricalChars: 800 });
    expect(body.messages[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.messages[1].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.messages[1].content[1].cache_control).toEqual({ type: "ephemeral" });
    expect(body.messages[2].cache_control).toEqual({ type: "ephemeral" });
  });
});
