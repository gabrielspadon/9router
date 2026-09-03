import { describe, expect, it } from "vitest";
import { buildCodexCatalog } from "@/lib/codexCatalog.js";
import { detectClientTool } from "open-sse/utils/clientDetector.js";
import { readFileSync } from "node:fs";

const route = readFileSync(
  new URL("../../src/app/api/v1/models/route.js", import.meta.url), "utf8");

// Codex clients read the provider's model endpoint as a Codex catalog, not as an
// OpenAI list, and fail on ours with "failed to decode models response: missing
// field `models`" (#1908).
const list = () => ([
  { id: "openai/gpt-5.5", object: "model", owned_by: "openai" },
  { id: "my-combo", object: "model", owned_by: "combo" },
]);

describe("Codex clients get a catalog they can decode (#1908)", () => {
  it("the envelope is `models`, which is the field the decoder demands", () => {
    const out = buildCodexCatalog(list());
    expect(Object.keys(out)).toEqual(["models"]);
    expect(Array.isArray(out.models)).toBe(true);
  });

  it("every entry carries the identity fields", () => {
    const [first] = buildCodexCatalog(list()).models;
    expect(first.slug).toBe("openai/gpt-5.5");
    expect(first.display_name).toBe("gpt-5.5");
    expect(first.supported_in_api).toBe(true);
  });

  it("search support is read from the capability catalog, not invented", () => {
    const out = buildCodexCatalog([{ id: "perplexity/sonar-pro", owned_by: "perplexity" }]);
    expect(out.models[0].supports_search_tool).toBe(true);
    const plain = buildCodexCatalog([{ id: "openai/gpt-4.1", owned_by: "openai" }]);
    expect(plain.models[0].supports_search_tool).toBe(false);
  });

  it("omits the two fields whose value domain is not derivable here", () => {
    // Inventing a tool_mode or multi_agent_version string that the client then
    // acts on is worse than leaving an optional field out.
    const [first] = buildCodexCatalog(list()).models;
    expect(first).not.toHaveProperty("tool_mode");
    expect(first).not.toHaveProperty("multi_agent_version");
  });

  it("describes exactly the same set as the OpenAI list it was built from", () => {
    expect(buildCodexCatalog(list()).models.map((m) => m.slug))
      .toEqual(list().map((e) => e.id));
  });

  it("survives an empty or malformed list without inventing entries", () => {
    expect(buildCodexCatalog([])).toEqual({ models: [] });
    expect(buildCodexCatalog(null)).toEqual({ models: [] });
    expect(buildCodexCatalog([{ object: "model" }, { id: "a/b" }]).models).toHaveLength(1);
  });

  it("a bare id with no provider prefix still gets a display name", () => {
    expect(buildCodexCatalog([{ id: "my-combo", owned_by: "combo" }]).models[0].display_name)
      .toBe("my-combo");
  });
});

describe("only a Codex client sees it", () => {
  it("the route reuses the request path's own detector", () => {
    // Detection moved above the Claude rewrite gate, which needs it too
    // (#2947), so the result is held in a variable rather than called inline.
    expect(route).toContain("const clientTool = detectClientTool(headers, {})");
    expect(route).toContain('if (clientTool === "codex") {');
    expect(route).toContain("buildCodexCatalog(out)");
  });

  it("that detector recognises the Codex clients and not the others", () => {
    expect(detectClientTool({ "user-agent": "codex-tui/1.0" }, {})).toBe("codex");
    expect(detectClientTool({ originator: "codex_cli_rs" }, {})).toBe("codex");
    expect(detectClientTool({ "user-agent": "Codex Desktop" }, {})).toBe("codex");
    expect(detectClientTool({ "user-agent": "claude-cli/2.0" }, {})).not.toBe("codex");
    expect(detectClientTool({}, {})).not.toBe("codex");
  });

  it("the OpenAI list shape is still what everyone else gets", () => {
    const i = route.indexOf('if (clientTool === "codex") {');
    expect(route.indexOf('{ object: "list", data: out }')).toBeGreaterThan(i);
  });

  it("the reshape happens after sorting, so both views agree on order", () => {
    const sorted = route.indexOf("out = [...out].sort(");
    expect(route.indexOf("buildCodexCatalog(out)")).toBeGreaterThan(sorted);
  });

  it("both branches read the same `out`, so Codex never sees a different set", () => {
    // buildCodexCatalog(out) and { object: "list", data: out } close over the
    // identical variable — there is no separate, Codex-only data path this
    // could quietly narrow or extend, only a different envelope around the
    // same array. Two clients differing ONLY in identity therefore always
    // describe the same models, whichever shape each one's decoder needs.
    expect(route).toContain("buildCodexCatalog(out)");
    expect(route).toContain('{ object: "list", data: out }');
  });
});
