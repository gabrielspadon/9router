// Upstream 2fd99eae5 — Claude Code carries its session in metadata.user_id, which
// the Responses API translation drops before the executor resolves a cache session.
// The request then fell through to the assistant-text hash / per-connection
// fallback, splitting one conversation across several prompt_cache_key values.
// The x-claude-code-session-id header survives every translation, so it is the
// fallback. The body stays authoritative when both are present.

import { describe, it, expect, beforeEach } from "vitest";
import { resolveSessionId, clearSessionStore } from "../../open-sse/utils/sessionManager.js";

const HEADER_UUID = "11111111-2222-3333-4444-555555555555";
const BODY_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const bodyWithSession = { metadata: { user_id: `user_abc_account_def_session_${BODY_UUID}` } };

beforeEach(() => {
  clearSessionStore();
});

describe("Claude Code session id via x-claude-code-session-id header", () => {
  it("uses the header when metadata.user_id is absent (Responses translation dropped it)", () => {
    const id = resolveSessionId({
      headers: { "x-claude-code-session-id": HEADER_UUID },
      body: { messages: [{ role: "user", content: "hello" }] },
      connectionId: "conn1",
    });
    expect(id).toBe(`claude:${HEADER_UUID}`);
  });

  it("body metadata.user_id still wins when both are present", () => {
    const id = resolveSessionId({
      headers: { "x-claude-code-session-id": HEADER_UUID },
      body: bodyWithSession,
      connectionId: "conn1",
    });
    expect(id).toBe(`claude:${BODY_UUID}`);
  });

  it("the header pins one session across connections and bodies that would otherwise diverge", () => {
    const headers = { "x-claude-code-session-id": HEADER_UUID };
    const a = resolveSessionId({ headers, body: { messages: [{ role: "user", content: "a" }] }, connectionId: "connA" });
    const b = resolveSessionId({ headers, body: { messages: [{ role: "user", content: "b" }] }, connectionId: "connB" });
    expect(a).toBe(b);
  });

  it("no header and no metadata falls through to the existing derivation", () => {
    const id = resolveSessionId({ headers: {}, body: { messages: [] }, connectionId: "conn1" });
    expect(id).not.toMatch(/^claude:/);
  });
});
