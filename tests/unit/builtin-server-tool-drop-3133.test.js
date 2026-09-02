import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareClaudeRequest } from "open-sse/translator/formats/claude.js";

// Anthropic's built-in server tools are executed by Anthropic, not by TokenProxy,
// so they cannot be forwarded to another provider and are stripped. The strip
// was silent, and the shape of that silence is a WebSearch that returns HTTP 200
// with nothing in it while WebFetch and POST /v1/search both work — which reads
// as a broken search rather than an unsupported one (#3133).
const webSearch = () => ({ type: "web_search_20250305", name: "web_search", max_uses: 5 });
const fnTool = () => ({ name: "Bash", description: "run", input_schema: { type: "object", properties: {} } });
const body = (tools) => ({ model: "glm-5.2", max_tokens: 256, messages: [{ role: "user", content: "hi" }], tools });

afterEach(() => vi.restoreAllMocks());

describe("dropping a built-in server tool is announced (#3133)", () => {
  it("warns, naming the tool and the provider that cannot run it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    prepareClaudeRequest(body([webSearch(), fnTool()]), "glm");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("web_search");
    expect(warn.mock.calls[0][0]).toContain("glm");
  });

  it("still strips it, since forwarding a tool the provider cannot run is worse", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = prepareClaudeRequest(body([webSearch(), fnTool()]), "glm");
    expect(out.tools.map((t) => t.name)).toEqual(["Bash"]);
  });

  it("stays quiet when the request carries only ordinary function tools", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    prepareClaudeRequest(body([fnTool()]), "glm");
    expect(warn).not.toHaveBeenCalled();
  });

  it("leaves Anthropic alone — there the tool is supported and must survive", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = prepareClaudeRequest(body([webSearch(), fnTool()]), "claude");
    expect(warn).not.toHaveBeenCalled();
    expect(out.tools.some((t) => t.type === "web_search_20250305")).toBe(true);
  });

  it("reports every dropped tool, not just the first", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    prepareClaudeRequest(body([
      webSearch(),
      { type: "code_execution_20250522", name: "code_execution" },
      fnTool(),
    ]), "kimi");
    expect(warn.mock.calls[0][0]).toContain("web_search");
    expect(warn.mock.calls[0][0]).toContain("code_execution");
  });
});
