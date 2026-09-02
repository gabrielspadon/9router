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
