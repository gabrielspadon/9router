import { describe, it, expect } from 'vitest';

import { compactContextWindow } from '../../open-sse/services/memory/contextCompactor.js';

// #2187: the compactor used to splice a fabricated "user" turn carrying the
// summary plus a fabricated "assistant" turn acknowledging it into the
// conversation. Claude/GPT started treating that invented dialogue as
// prompt-injected tool history and refused to proceed. The fix carries the
// summary as system-scoped blocks instead of putting words in either party's
// mouth.
describe('Context Compactor: summary is system-scoped, not a fabricated dialogue (#2187)', () => {
  const buildBody = () => {
    const messages = [{ role: 'system', content: 'You are a senior coding assistant.' }];
    for (let i = 1; i <= 25; i++) {
      messages.push({
        role: 'user',
        content: `Step ${i}: Detailed requirement explanations and background data `.repeat(10),
      });
      messages.push({
        role: 'assistant',
        content: `Step ${i}: Executed operations and generated module `.repeat(10),
      });
    }
    return { messages };
  };

  it('never injects a synthetic user or assistant turn to carry the summary', () => {
    const body = buildBody();
    const res = compactContextWindow(body, {
      enabled: true,
      thresholdTokens: 500,
      recentTurnsToKeep: 4,
    });

    expect(res.compacted).toBe(true);

    // No message should be a fabricated user turn holding the summary marker.
    const fakeUserTurn = body.messages.find(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('[Historical Context Summary')
    );
    expect(fakeUserTurn).toBeUndefined();

    // No message should be a fabricated assistant turn claiming to have "reviewed"
    // content the user never actually sent.
    const fakeAssistantAck = body.messages.find(
      (m) =>
        m.role === 'assistant' &&
        typeof m.content === 'string' &&
        m.content.toLowerCase().includes('i have reviewed')
    );
    expect(fakeAssistantAck).toBeUndefined();
  });

  it('carries the summary in a system-scoped block', () => {
    const body = buildBody();
    compactContextWindow(body, { enabled: true, thresholdTokens: 500, recentTurnsToKeep: 4 });

    const summaryBlock = body.messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        m.content.includes('[Historical Context Summary')
    );
    expect(summaryBlock).toBeTruthy();
  });

  it('keeps the pre-existing shape the rest of the pipeline relies on (system head, 2-block summary, recent tail)', () => {
    const body = buildBody();
    const res = compactContextWindow(body, {
      enabled: true,
      thresholdTokens: 500,
      recentTurnsToKeep: 4,
    });

    expect(res.savedTokens > 0).toBeTruthy();
    expect(body.messages[0].role).toBe('system');
    expect(
      body.messages[1].content.includes('[Historical Context Summary by tokenproxy Memory Optimizer]')
    ).toBeTruthy();
    expect(body.messages.length).toBe(1 + 2 + 4);
  });
});

// Token-saver audit follow-ups: the compactor runs AFTER the one claude
// normalizer that folds system messages, so role:"system" inside messages[]
// ships an API-rejected shape to claude targets; option coercion; mid-
// conversation system messages; elide-marker preservation in summaries.
describe("Context Compactor: claude targets, coercion, and marker preservation", () => {
  const big = (tag) => ({ role: "user", content: `${tag} `.repeat(600) });

  const claudeBody = () => ({
    messages: [
      { role: "system", content: "sys head" },
      big("alpha"),
      { role: "assistant", content: "beta ".repeat(600) },
      big("gamma"),
      { role: "assistant", content: "delta ".repeat(600) },
      { role: "user", content: "the live question" },
    ],
  });

  it("claude target: summary+notice ship as one labeled user note, never role system", () => {
    const body = claudeBody();
    const res = compactContextWindow(body, {
      enabled: true,
      thresholdTokens: 100,
      recentTurnsToKeep: 2,
      format: "claude",
    });
    expect(res.compacted).toBe(true);
    // No role:"system" inside messages[] beyond the preserved head.
    const nonHeadSystem = body.messages.slice(1).filter((m) => m.role === "system");
    expect(nonHeadSystem).toHaveLength(0);
    const note = body.messages[1];
    expect(note.role).toBe("user");
    expect(note.content).toContain("[tokenproxy context note] ");
    expect(note.content).toContain("[Historical Context Summary by tokenproxy Memory Optimizer]");
    expect(note.content).toContain("continue the conversation using it as context");
    // head + note + 2 recent
    expect(body.messages).toHaveLength(4);
  });

  it("mid-conversation system messages are preserved verbatim, not silently dropped", () => {
    const body = claudeBody();
    body.messages.splice(3, 0, { role: "system", content: "mid-conversation system instruction" });
    compactContextWindow(body, {
      enabled: true,
      thresholdTokens: 100,
      recentTurnsToKeep: 2,
      format: "claude",
    });
    expect(
      body.messages.some((m) => m.content === "mid-conversation system instruction"),
    ).toBe(true);
  });

  it("coerces NaN threshold and non-positive recentTurnsToKeep instead of misfiring", () => {
    // NaN threshold fell back to the default: this small body is way under
    // it, so nothing compacts (the old code compared against NaN and fired).
    const nanBody = claudeBody();
    const nanRes = compactContextWindow(nanBody, {
      enabled: true,
      thresholdTokens: NaN,
      recentTurnsToKeep: 2,
      format: "claude",
    });
    expect(nanRes.compacted).toBe(false);
    expect(nanBody.messages).toHaveLength(6);

    // recentTurnsToKeep 0 used to replace the whole conversation including
    // the current query; the current query must always survive.
    const zeroBody = { messages: [big("old"), big("older"), { role: "user", content: "current query" }] };
    const zeroRes = compactContextWindow(zeroBody, {
      enabled: true,
      thresholdTokens: 10,
      recentTurnsToKeep: 0,
      format: "claude",
    });
    if (zeroRes.compacted) {
      expect(zeroBody.messages.at(-1).content).toBe("current query");
    }
  });

  it("keeps the rtk elide marker visible in the summary and never fabricates the word output", () => {
    const marker = "head\n[elided 12 chars · hmac abcdef12 · head+tail preserved by tokenproxy]\ntail";
    const body = {
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "old turn " + "x".repeat(2000) },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: marker }],
        },
        { role: "user", content: "recent question" },
        { role: "assistant", content: "recent answer" },
      ],
    };
    compactContextWindow(body, {
      enabled: true,
      thresholdTokens: 100,
      recentTurnsToKeep: 2,
      format: "claude",
    });
    const note = body.messages.find((m) => m.role === "user" && m.content.includes("Historical Context Summary"));
    expect(note).toBeTruthy();
    expect(note.content).toContain("head+tail preserved by tokenproxy");
    expect(note.content).toContain("preserved verbatim");
    expect(note.content).not.toContain("[tool result: output]");
  });
});
