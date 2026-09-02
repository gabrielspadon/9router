// Issue #1092: a combo is one flat pool, so a sub-agent spawned for an
// auxiliary task draws from the same top-tier members the main loop does. The
// hard half is telling the two apart — a sub-agent request is an ordinary chat
// request over the same endpoint with the same key, and only the preamble
// differs — so detection is narrow, and the whole feature stays inert until the
// user assigns groups.
import { describe, expect, it } from "vitest";
import { detectAgentRole, applyAgentRoleGroup } from "open-sse/utils/agentRole.js";

const CC = "claude-cli/2.1.0";
const COMBO = ["big/flagship", "mid/workhorse", "cheap/tiny"];

describe("telling a sub-agent from the parent (#1092)", () => {
  it("is null for a client whose preamble is not known", () => {
    expect(detectAgentRole({ system: "You are an agent for Claude Code" }, "curl/8")).toBeNull();
    expect(detectAgentRole({ system: "anything" }, "")).toBeNull();
  });

  it("reads the sub-agent preamble from a top-level system string", () => {
    expect(detectAgentRole({ system: "You are an agent for Claude Code, doing X" }, CC)).toBe("sub");
  });

  it("reads it from Anthropic system blocks", () => {
    const body = { system: [{ type: "text", text: "You are an agent for Claude Code" }] };
    expect(detectAgentRole(body, CC)).toBe("sub");
  });

  it("reads it from an OpenAI-shaped system message", () => {
    const body = { messages: [{ role: "system", content: "You are a sub-agent handling search" }] };
    expect(detectAgentRole(body, CC)).toBe("sub");
  });

  it("calls the main loop the parent", () => {
    const body = { system: [{ type: "text", text: "You are Claude Code, Anthropic's official CLI" }] };
    expect(detectAgentRole(body, CC)).toBe("parent");
  });

  it("treats an unrecognised preamble as the parent, which is the old behaviour", () => {
    expect(detectAgentRole({ system: "Something new upstream shipped" }, CC)).toBe("parent");
    expect(detectAgentRole({}, CC)).toBe("parent");
  });

  it("only matches the preamble at the start, not a mention further in", () => {
    const body = { system: "Answer the user. Do not claim you are a sub-agent." };
    expect(detectAgentRole(body, CC)).toBe("parent");
  });
});

describe("narrowing a combo to the role's group (#1092)", () => {
  const settings = {
    agentRoles: { parent: ["big/flagship"], sub: ["mid/workhorse", "cheap/tiny"] },
  };

  it("gives the parent its group", () => {
    expect(applyAgentRoleGroup(COMBO, "parent", settings)).toEqual(["big/flagship"]);
  });

  it("gives a sub-agent its group", () => {
    expect(applyAgentRoleGroup(COMBO, "sub", settings)).toEqual(["mid/workhorse", "cheap/tiny"]);
  });

  it("keeps the combo's own order, not the group's", () => {
    const reversed = { agentRoles: { sub: ["cheap/tiny", "mid/workhorse"] } };
    expect(applyAgentRoleGroup(COMBO, "sub", reversed)).toEqual(["mid/workhorse", "cheap/tiny"]);
  });

  it("is inert with no groups configured", () => {
    expect(applyAgentRoleGroup(COMBO, "sub", {})).toEqual(COMBO);
    expect(applyAgentRoleGroup(COMBO, "sub", { agentRoles: { sub: [] } })).toEqual(COMBO);
  });

  it("is inert when the role is unknown", () => {
    expect(applyAgentRoleGroup(COMBO, null, settings)).toEqual(COMBO);
  });

  it("falls back to the whole combo rather than routing nowhere", () => {
    const absent = { agentRoles: { sub: ["nothing/here"] } };
    expect(applyAgentRoleGroup(COMBO, "sub", absent)).toEqual(COMBO);
  });

  it("leaves an empty or non-list input alone", () => {
    expect(applyAgentRoleGroup([], "sub", settings)).toEqual([]);
    expect(applyAgentRoleGroup(null, "sub", settings)).toBeNull();
  });
});
