import { describe, expect, it } from "vitest";
import { decloakToolNames } from "open-sse/utils/claudeCloaking.js";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../open-sse/${p}`, import.meta.url), "utf8");
const map = () => new Map([["exec_ide", "exec"], ["run_query_ide", "run_query"]]);

// Client tools are cloaked with a suffix on the way out and restored on the way
// back. The non-streaming handler restored them; the forced-SSE-to-JSON path
// never did, so a Claude provider that forces streaming handed a client that
// declared `exec` a tool_use named `exec_ide`, which it rejected as unknown
// (#2693). Restoring means one function has to know all three response shapes
// the router produces.
describe("cloaked tool names are restored in every response shape (#2693)", () => {
  it("Claude content blocks", () => {
    const out = decloakToolNames({
      type: "message",
      content: [{ type: "text", text: "ok" }, { type: "tool_use", id: "t1", name: "exec_ide", input: { command: "echo" } }],
    }, map());
    expect(out.content[1].name).toBe("exec");
    expect(out.content[1].input).toEqual({ command: "echo" });
  });

  it("OpenAI tool_calls, which is what the forced-SSE path parses into", () => {
    const out = decloakToolNames({
      choices: [{ index: 0, message: { role: "assistant", tool_calls: [
        { id: "c1", type: "function", function: { name: "exec_ide", arguments: "{}" } },
        { id: "c2", type: "function", function: { name: "run_query_ide", arguments: "{}" } },
      ] } }],
    }, map());
    const names = out.choices[0].message.tool_calls.map((t) => t.function.name);
    expect(names).toEqual(["exec", "run_query"]);
  });

  it("Responses output items", () => {
    const out = decloakToolNames({
      object: "response",
      output: [{ type: "function_call", name: "exec_ide", arguments: "{}" }],
    }, map());
    expect(out.output[0].name).toBe("exec");
  });

  it("a name that was never cloaked is left alone", () => {
    const out = decloakToolNames({
      choices: [{ message: { tool_calls: [{ function: { name: "WebSearch", arguments: "{}" } }] } }],
    }, map());
    expect(out.choices[0].message.tool_calls[0].function.name).toBe("WebSearch");
  });

  it("an empty or absent map is a no-op, and the body comes back identical", () => {
    const body = { choices: [{ message: { tool_calls: [{ function: { name: "exec_ide" } }] } }] };
    expect(decloakToolNames(body, new Map())).toBe(body);
    expect(decloakToolNames(body, null)).toBe(body);
  });

  it("a shape it does not recognise is returned untouched rather than mangled", () => {
    const body = { something: "else" };
    expect(decloakToolNames(body, map())).toBe(body);
  });

  it("it does not mutate the response it was given", () => {
    const body = { choices: [{ message: { tool_calls: [{ function: { name: "exec_ide" } }] } }] };
    decloakToolNames(body, map());
    expect(body.choices[0].message.tool_calls[0].function.name).toBe("exec_ide");
  });
});

describe("the forced-SSE path actually calls it", () => {
  const src = read("handlers/chatCore/sseToJsonHandler.js");

  it("takes the map", () => {
    expect(src).toMatch(/notifyTerminal, toolNameMap, customToolNames/);
  });

  it("restores names on both of its branches", () => {
    expect(src.match(/decloakToolNames\(/g)?.length).toBe(2);
  });

  it("and chatCore passes the map at both call sites", () => {
    const core = read("handlers/chatCore.js");
    const calls = [...core.matchAll(/handleForcedSSEToJson\(\{[\s\S]{0,400}?\}\)/g)];
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c[0]).toContain("toolNameMap");
  });
});
