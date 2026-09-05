// Error-flagged historical tool_results are EXEMPT from memory pruning.
// Evidence contract (rtk/index.js:8-13): is_error/isError/status:'error'
// results are traces and are never compressed by RTK; the memory tool pruner
// must honour the same exemption, at block level and item level inside
// content arrays, across the Claude/OpenAI/Responses message shapes.
import { describe, it, expect } from "vitest";

import { pruneHistoricalTools } from "../../open-sse/services/memory/toolPruner.js";

const NOTICE = "Tool output truncated by tokenproxy memory optimizer";

function big(prefix) {
  return `${prefix}\n`.repeat(60);
}

describe("memory tool pruner: error-flagged results exempt", () => {
  const opts = { enabled: true, keepRecentTurns: 0, maxHistoricalChars: 200 };

  it("Claude tool_result with is_error survives byte-identical; neighbor prunes", () => {
    const errOut = big("compile failed at src/foo.c:41 undefined reference");
    const okOut = big("build succeeded 42 files");
    const body = {
      messages: [
        { role: "user", content: "build" },
        { role: "assistant", content: "a", tool_calls: [{ id: "c1", function: { name: "build" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", is_error: true, content: [{ type: "text", text: errOut }] }] },
        { role: "assistant", content: "b", tool_calls: [{ id: "c2", function: { name: "test" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "c2", content: [{ type: "text", text: okOut }] }] },
      ],
    };

    const res = pruneHistoricalTools(body, opts);

    const errBlock = body.messages[2].content[0];
    const okBlock = body.messages[4].content[0];
    expect(errBlock.content[0].text).toBe(errOut);
    expect(errBlock.content[0].text).not.toContain(NOTICE);
    expect(okBlock.content[0].text).not.toBe(okOut);
    expect(okBlock.content[0].text).toContain(NOTICE);
    expect(res.count).toBe(1);
  });

  it("item-level isError inside a Claude content array exempts only that item", () => {
    const errItem = big("traceback at module.js:17");
    const okItem = big("diff +++ b/file.js");
    const before = JSON.stringify([errItem, okItem]);
    const body = {
      messages: [
        { role: "assistant", content: "a", tool_calls: [{ id: "c1", function: { name: "run" } }] },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "c1", content: [
            { type: "text", isError: true, text: errItem },
            { type: "text", text: okItem },
          ] },
        ] },
      ],
    };

    const res = pruneHistoricalTools(body, opts);
    const subs = body.messages[1].content[0].content;

    expect(subs[0].text).toBe(errItem);
    expect(subs[0].text).not.toContain(NOTICE);
    expect(subs[1].text).not.toBe(okItem);
    expect(subs[1].text).toContain(NOTICE);
    expect(res.count).toBe(1);
    // the error item bytes unchanged even after serialization
    expect(JSON.stringify([subs[0].text, subs[1].text])).not.toBe(before);
  });

  it("OpenAI tool role: msg-level is_error exempt; string neighbor prunes", () => {
    const errOut = big("ECONNREFUSED 127.0.0.1:5432");
    const okOut = big("query returned 3 rows");
    const body = {
      messages: [
        { role: "assistant", content: "a", tool_calls: [{ id: "c1", function: { name: "db" } }] },
        { role: "tool", tool_call_id: "c1", is_error: true, content: errOut },
        { role: "assistant", content: "b", tool_calls: [{ id: "c2", function: { name: "db" } }] },
        { role: "tool", tool_call_id: "c2", content: okOut },
      ],
    };

    const res = pruneHistoricalTools(body, opts);

    expect(body.messages[1].content).toBe(errOut);
    expect(body.messages[1].content).not.toContain(NOTICE);
    expect(body.messages[3].content).toContain(NOTICE);
    expect(res.count).toBe(1);
  });

  it("OpenAI array content: item-level status:'error' exempts only that part", () => {
    const errPart = big("segmentation fault core dumped");
    const okPart = big("stdout of lint");
    const body = {
      messages: [
        { role: "assistant", content: "a", tool_calls: [{ id: "c1", function: { name: "lint" } }] },
        { role: "tool", tool_call_id: "c1", content: [
          { type: "text", status: "error", text: errPart },
          { type: "text", text: okPart },
        ] },
      ],
    };

    const res = pruneHistoricalTools(body, opts);

    expect(body.messages[1].content[0].text).toBe(errPart);
    expect(body.messages[1].content[0].text).not.toContain(NOTICE);
    expect(body.messages[1].content[1].text).toContain(NOTICE);
    expect(res.count).toBe(1);
  });

  it("Responses function_call_output with status:'error' survives", () => {
    const errOut = big("500 internal from api.example.com");
    const okOut = big("200 ok payload");
    const body = {
      messages: [
        { role: "assistant", content: "a", tool_calls: [{ id: "c1", type: "function", function: { name: "api" } }] },
        { role: "tool", call_id: "c1", type: "function_call_output", status: "error", output: [{ type: "input_text", text: errOut }] },
        { role: "assistant", content: "b", tool_calls: [{ id: "c2", type: "function", function: { name: "api" } }] },
        { role: "tool", call_id: "c2", type: "function_call_output", output: [{ type: "input_text", text: okOut }] },
      ],
    };

    const res = pruneHistoricalTools(body, opts);

    expect(body.messages[1].output[0].text).toBe(errOut);
    expect(body.messages[1].output[0].text).not.toContain(NOTICE);
    expect(body.messages[3].output[0].text).toContain(NOTICE);
    expect(res.count).toBe(1);
  });
});

describe("R-F2: error:true and status:'failed' are exempt from pruning", () => {
  const opts = { enabled: true, keepRecentTurns: 0, maxHistoricalChars: 200 };

  it("OpenAI tool msg with error:true survives byte-identical", () => {
    const out = big("segfault at module.js:17");
    const body = { messages: [{ role: "tool", tool_call_id: "c1", error: true, content: out }] };
    const res = pruneHistoricalTools(body, opts);
    expect(body.messages[0].content).toBe(out);
    expect(res.count).toBe(0);
  });

  it("Responses function_call_output with status:'failed' survives byte-identical", () => {
    const out = big("job failed at step 3");
    const body = { messages: [{ type: "function_call_output", call_id: "c2", status: "failed", output: out }] };
    const res = pruneHistoricalTools(body, opts);
    expect(body.messages[0].output).toBe(out);
    expect(res.count).toBe(0);
  });

  it("item-level error:true inside a Claude content array exempts only that item", () => {
    const errItem = big("traceback at worker.js:9");
    const okItem = big("ordinary log output");
    const body = {
      messages: [
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "c3", content: [
            { type: "text", error: true, text: errItem },
            { type: "text", text: okItem },
          ] },
        ] },
      ],
    };
    const res = pruneHistoricalTools(body, opts);
    const subs = body.messages[0].content[0].content;
    expect(subs[0].text).toBe(errItem);
    expect(subs[1].text).not.toBe(okItem);
    expect(res.count).toBe(1);
  });
});
