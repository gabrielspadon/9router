import { describe, it, expect } from 'vitest';
import { compressPrefixByQuery } from '../../open-sse/utils/queryAwareCompress.js';

// Topic A: ~120-word turns about spline calibration, repeated across 10 turns
// so keyword overlap with the topic-B query stays low but non-zero (shared
// filler words like "the", "team" get tokenized out or diluted by threshold).
const TOPIC_A = Array.from(
  { length: 24 },
  (_, i) => `calibration reticulated spline procedure step${i}`
).join(' ');

function turn(role, content) {
  return { role, content };
}

function textTurn(role, text) {
  return turn(role, [{ type: 'text', text }]);
}

function toolResultTurn() {
  return turn('user', [
    { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'ok' }] },
  ]);
}

function buildConversation() {
  const messages = [];
  for (let i = 0; i < 5; i++) {
    messages.push(textTurn('user', `${TOPIC_A} turn ${i} question`));
    messages.push(textTurn('assistant', `${TOPIC_A} turn ${i} answer`));
  }
  // Final user turn: topic B, becomes the query at turn N.
  messages.push(
    textTurn('user', 'widget inventory reconciliation deadline urgent warehouse audit')
  );
  return messages;
}

describe('qac prefix stability across turns', () => {
  it('oscillates: the same historical prefix is compressed at turn N and uncompressed at turn N+1', () => {
    const base = buildConversation();
    const queryN = base[base.length - 1].content[0].text;

    // Turn N: production runs qac with the last user message as the query.
    // chatCore hands the same per-session memo to every request of a
    // session; a decision taken on turn N is replayed on N+1 by the memo,
    // whatever N+1's query (here: none, a tool_result turn) says.
    const memo = new Set();
    const resultN = compressPrefixByQuery(base, { query: queryN, memo });
    const upstreamN = resultN.messages.slice(0, 8).map((m) => JSON.stringify(m));

    // Turn N+1: assistant replies, then a user turn carrying only a
    // tool_result block. qacWillRun derives the query from the last user
    // message's text; a tool_result-only message yields an empty string, so
    // production skips the stage entirely for this request.
    const nextTurnMessages = [
      ...base,
      textTurn('assistant', 'reconciliation noted, checking the warehouse audit'),
      toolResultTurn(),
    ];
    const emptyQuery = ''; // what qacWillRun derives from a tool_result-only user turn
    const resultN1 = compressPrefixByQuery(nextTurnMessages, { query: emptyQuery, memo });
    const upstreamN1 = resultN1.messages.slice(0, 8).map((m) => JSON.stringify(m));

    // FAILING: production sends compressed prefix text at turn N and the
    // same historical turns fully uncompressed at turn N+1 (stage skipped),
    // so what the model reads for identical history flips between requests.
    expect(upstreamN1).toEqual(upstreamN);
  });

  it('growth: a block shorter than its placeholder is left verbatim, longer ones are compressed', () => {
    const shortText = 'xyzzy plugh zorp glorb wibble frobnicate'; // 40 chars, unrelated to the query
    expect(shortText.length).toBe(40);
    const messages = [
      ...Array.from({ length: 4 }, (_, i) => textTurn('user', `${TOPIC_A} pad ${i}`)),
      textTurn('assistant', shortText),
      textTurn('user', 'widget inventory reconciliation deadline urgent warehouse audit'),
    ];
    const query = messages[messages.length - 1].content[0].text;
    const result = compressPrefixByQuery(messages, { query, keepRecentTurns: 2 });
    // The 40-char block: a placeholder would be ~140 chars, so it stays.
    expect(result.messages[4].content[0].text).toBe(shortText);
    // The long low-relevance pads before it are compressed, and each
    // placeholder is shorter than what it replaced.
    expect(result.compressed).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) {
      const out = result.messages[i].content[0].text;
      expect(out).toContain('compressed, low relevance');
      expect(out.length).toBeLessThan(messages[i].content[0].text.length);
    }
  });

  it("fixed point: re-running on the stage's own output with the same query is a no-op", () => {
    const messages = buildConversation();
    const query = messages[messages.length - 1].content[0].text;
    const first = compressPrefixByQuery(messages, { query });
    expect(first.compressed).toBeGreaterThan(0);

    const second = compressPrefixByQuery(first.messages, { query });

    // States the fixed-point property without forcing pass or fail: applying
    // the stage to its own output with the same query should compress
    // nothing further and leave messages unchanged.
    expect(second.compressed).toBe(0);
    expect(second.messages).toEqual(first.messages);
  });
});
