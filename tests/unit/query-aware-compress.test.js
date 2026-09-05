import { describe, it, expect } from 'vitest';
import { compressPrefixByQuery } from '../../open-sse/utils/queryAwareCompress.js';

const QUERY = 'reticulated spline calibration procedure';

function turn(role, text) {
  return { role, content: [{ type: 'text', text }] };
}

// Irrelevant historical blocks must run comfortably longer than the ~140-char
// placeholder (open + 60-char default preview + close), or the new
// never-grows-a-block rule leaves them verbatim instead of compressing them.
const LUNCH_TEXT =
  'lunch order for the team pizza sandwiches salad plus napkins drinks and ' +
  'dessert options collected by the office manager from every team member ' +
  'before the catering request gets finalized for tomorrow morning all ' +
  'hands meeting downstairs near the lobby entrance area';
const PIZZA_TEXT =
  'the pizza place closes at six but the catering coordinator already ' +
  'confirmed a late pickup slot with the manager for the leftover trays so ' +
  'nobody has to rush before the delivery window ends this evening downtown';
const DEPLOY_TEXT =
  'what about the deploy window today given the recent staging environment ' +
  'issues that the platform team flagged during yesterday incident review ' +
  'and the pending approval from the release manager before we can proceed ' +
  'with the rollout schedule this afternoon';

// Four historical turns plus two recent ones. Historical: one relevant to the
// query, one irrelevant. Recent: both irrelevant on purpose.
function conversation() {
  return [
    turn('user', 'can we reticulate the spline calibration procedure before the run'),
    turn('assistant', 'yes the reticulated spline calibration is staged'),
    turn('user', LUNCH_TEXT),
    turn('assistant', PIZZA_TEXT),
    turn('user', DEPLOY_TEXT),
    turn('assistant', 'deploy window is after lunch'),
  ];
}

const scoreFor = (text, termCount) => {
  const words = text.toLowerCase().match(/[a-z0-9]+/g).length;
  return 1 / (1 + Math.log2(1 + words / 8)) / termCount;
};

describe('compressPrefixByQuery', () => {
  it('fails open on a short query and returns the input reference', () => {
    const messages = conversation();
    const result = compressPrefixByQuery(messages, { query: 'deploy' });
    expect(result.messages).toBe(messages);
    expect(result.compressed).toBe(0);
    expect(result.notes).toEqual([]);
  });

  it('fails open when query has fewer than 3 usable terms', () => {
    const messages = conversation();
    const result = compressPrefixByQuery(messages, { query: 'deploy now ok' });
    expect(result.messages).toBe(messages);
    expect(result.compressed).toBe(0);
  });

  it('fails open on empty messages', () => {
    const messages = [];
    const result = compressPrefixByQuery(messages, { query: QUERY });
    expect(result.messages).toBe(messages);
    expect(result.compressed).toBe(0);
  });

  it('compresses irrelevant historical blocks and keeps relevant ones verbatim', () => {
    const messages = conversation();
    const result = compressPrefixByQuery(messages, { query: QUERY });
    expect(result.compressed).toBe(2);
    // Relevant historical turns untouched, by reference.
    expect(result.messages[0]).toBe(messages[0]);
    expect(result.messages[1]).toBe(messages[1]);
    // Irrelevant historical turns compressed with the placeholder (preview
    // truncated to the default 60 chars, since the fixtures now run longer).
    expect(result.messages[2].content[0].text).toBe(
      '[tokenproxy: earlier turn about "lunch order for the team pizza sandwiches salad plus napkins" ' +
        'compressed, low relevance to the current query]'
    );
    expect(result.messages[3].content[0].text).toContain('[tokenproxy: earlier turn about');
    expect(result.notes).toEqual([
      { turn: 2, preview: 'lunch order for the team pizza sandwiches salad plus napkins' },
      { turn: 3, preview: 'the pizza place closes at six but the catering coordinator a' },
    ]);
  });

  it('never touches recent turns even when they are irrelevant', () => {
    const messages = conversation();
    const result = compressPrefixByQuery(messages, { query: QUERY });
    expect(result.messages[4]).toBe(messages[4]);
    expect(result.messages[5]).toBe(messages[5]);
    expect(result.compressed).toBe(2);
  });

  it('respects a custom keepRecentTurns boundary', () => {
    const messages = conversation();
    const result = compressPrefixByQuery(messages, { query: QUERY, keepRecentTurns: 1 });
    // Only the last turn is held back now, so recent irrelevant turns 2-4 compress.
    expect(result.compressed).toBe(3);
    expect(result.messages[0]).toBe(messages[0]);
    expect(result.messages[1]).toBe(messages[1]);
    expect(result.messages[2].content[0].text).toContain('[tokenproxy:');
    expect(result.messages[4].content[0].text).toContain('[tokenproxy:');
  });

  it('keeps a block at exactly the threshold, compresses below it', () => {
    // Exactly one of the four query terms present in the historical block.
    // Long enough that its placeholder would fit under the never-grows rule;
    // the exact score is recomputed from this text, not hardcoded.
    const termCount = 4;
    const text =
      'the calibration is due tonight after the extended maintenance window closes and ' +
      'the team reconvenes to review outstanding action items from last week retrospective ' +
      'meeting before the holiday break begins for everyone on the infrastructure squad ' +
      'working late nights this quarter';
    const exact = scoreFor(text, termCount);
    const messages = [
      turn('user', text),
      turn('user', 'reticulated spline calibration'),
      turn('assistant', 'ok'),
    ];
    const kept = compressPrefixByQuery(messages, {
      query: QUERY,
      threshold: exact,
    });
    expect(kept.messages).toBe(messages);
    expect(kept.compressed).toBe(0);
    const gone = compressPrefixByQuery(messages, {
      query: QUERY,
      threshold: exact + 1e-12,
    });
    expect(gone.compressed).toBe(1);
    expect(gone.messages[0].content[0].text).toContain('[tokenproxy: earlier turn about');
  });

  it('treats string content as one block and replaces it with the placeholder string', () => {
    const messages = [
      { role: 'user', content: LUNCH_TEXT },
      { role: 'assistant', content: 'reticulated spline calibration is staged' },
      { role: 'user', content: 'what about the deploy window today' },
    ];
    const result = compressPrefixByQuery(messages, { query: QUERY });
    expect(result.compressed).toBe(1);
    expect(result.messages[0].content).toBe(
      '[tokenproxy: earlier turn about "lunch order for the team pizza sandwiches salad plus napkins" ' +
        'compressed, low relevance to the current query]'
    );
    expect(result.notes).toEqual([
      { turn: 0, preview: 'lunch order for the team pizza sandwiches salad plus napkins' },
    ]);
  });

  it('honors previewChars in the placeholder and notes', () => {
    const messages = conversation();
    const result = compressPrefixByQuery(messages, { query: QUERY, previewChars: 10 });
    expect(result.messages[2].content[0].text).toBe(
      '[tokenproxy: earlier turn about "lunch orde" compressed, low relevance to the current query]'
    );
    expect(result.notes[0].preview).toBe('lunch orde');
  });

  it('does not mutate a deep-frozen input and shares untouched parts by reference', () => {
    const messages = conversation();
    const deepFreeze = (value) => {
      if (value && typeof value === 'object') {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
      }
    };
    deepFreeze(messages);
    const result = compressPrefixByQuery(messages, { query: QUERY });
    expect(result.messages).not.toBe(messages);
    expect(result.messages[0]).toBe(messages[0]);
    expect(result.messages[1]).toBe(messages[1]);
    expect(result.messages[2]).not.toBe(messages[2]);
    expect(result.messages[2].content[0]).not.toBe(messages[2].content[0]);
    expect(result.messages[2].content).not.toBe(messages[2].content);
    // Original intact.
    expect(messages[2].content[0].text).toBe(LUNCH_TEXT);
  });

  it('caps notes at 8 and sets notesTruncated', () => {
    const messages = [];
    for (let i = 0; i < 12; i++) {
      messages.push(
        turn(
          'user',
          `lunch order number ${i} pizza salad extra topping requests were collected today ` +
            'from various departments across the building including marketing sales ' +
            'engineering and finance before the vendor confirmed final headcount for ' +
            'catering purposes this week'
        )
      );
    }
    messages.push(turn('user', 'reticulated spline calibration'));
    messages.push(turn('user', 'reticulated spline calibration again'));
    const result = compressPrefixByQuery(messages, { query: QUERY });
    expect(result.compressed).toBe(12);
    expect(result.notes).toHaveLength(8);
    expect(result.notesTruncated).toBe(true);
    expect(result.messages[11].content[0].text).toContain('[tokenproxy:');
  });

  it('returns input reference when nothing falls below the threshold', () => {
    const messages = conversation();
    const result = compressPrefixByQuery(messages, { query: QUERY, threshold: 0 });
    expect(result.messages).toBe(messages);
    expect(result.compressed).toBe(0);
    expect(result.notesTruncated).toBe(false);
  });

  it('leaves tool_result content and system messages alone', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', content: 'lunch order pizza salad' },
          {
            type: 'text',
            text:
              'lunch order pizza salad details including extra toppings requested by ' +
              'various team members plus drink preferences and dessert selections ' +
              'gathered ahead of tomorrow catering deadline for the downtown office ' +
              'kitchen delivery slot this week',
          },
        ],
      },
      { role: 'system', content: [{ type: 'text', text: 'lunch order pizza' }] },
      { role: 'user', content: 'what about the deploy window today' },
      { role: 'assistant', content: [{ type: 'text', text: 'deploy after lunch' }] },
    ];
    const result = compressPrefixByQuery(messages, { query: QUERY });
    // Only the role-level text block compresses; the tool_result block and the
    // system message pass through by reference.
    expect(result.compressed).toBe(1);
    expect(result.messages[0].content[0]).toBe(messages[0].content[0]);
    expect(result.messages[1]).toBe(messages[1]);
    expect(result.messages[0].content[1].text).toContain('[tokenproxy:');
  });

  it('leaves a block verbatim when its placeholder would not be shorter than the text', () => {
    // Short irrelevant block: the ~140-char placeholder is longer than the
    // text itself, so the never-grows-a-block rule keeps it untouched.
    const messages = [
      turn('user', 'lunch order pizza'),
      turn('user', 'reticulated spline calibration'),
      turn('assistant', 'ok'),
    ];
    const result = compressPrefixByQuery(messages, { query: QUERY });
    expect(result.messages).toBe(messages);
    expect(result.compressed).toBe(0);
  });
});

const ELIDE_MARKER =
  'head\n[elided 12 chars · hmac abcdef12 · head+tail preserved by tokenproxy]\ntail';

describe('audit follow-ups: elide-marker awareness, 0.04 default, emoji-safe previews', () => {
  it('never placeholder-compresses a historical block carrying the rtk elide marker, even at score 0', () => {
    // Zero lexical overlap with the query: score 0, far below any threshold.
    const messages = [
      {
        role: 'user',
        content: `unrelated lunch pizza salad debate notes `.repeat(4) + ELIDE_MARKER,
      },
      { role: 'assistant', content: 'pizza place closes at six' },
      { role: 'user', content: 'how do I configure the retry backoff for the api gateway' },
    ];
    const result = compressPrefixByQuery(messages, {
      query: 'reticulated spline calibration procedure guide',
    });
    expect(result.compressed).toBe(0); // marker turn is the only historical one
    expect(result.messages[0].content).toContain('head+tail preserved by tokenproxy');
    expect(result.messages[0].content).not.toContain('compressed, low relevance');
  });

  it('guards the block-content path too: a text block with the marker survives inside array content', () => {
    const messages = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'banana logistics notes ' + ELIDE_MARKER }],
      },
      { role: 'assistant', content: 'the banana place closes at six' },
      { role: 'user', content: 'how do I configure the retry backoff for the api gateway' },
    ];
    const result = compressPrefixByQuery(messages, {
      query: 'reticulated spline calibration procedure guide',
    });
    expect(result.compressed).toBe(0);
    expect(result.messages[0].content[0].text).toContain('head+tail preserved by tokenproxy');
  });

  it('default threshold is 0.04: keeps a weakly-relevant block that 0.08 destroyed', () => {
    // 1 of 8 query terms in a longer-than-placeholder block: score ~0.055,
    // inside (0.04, 0.08).
    const messages = [
      {
        role: 'user',
        content:
          'hotel booking for tonight needs confirmation before the front desk closes ' +
          'so someone should call and leave a message with the reservation number',
      },
      {
        role: 'assistant',
        content:
          'ok that works for me lets plan on that and follow up early tomorrow once ' +
          'everyone confirms availability so we can finalize logistics for the trip ' +
          'during our next check in meeting downtown',
      },
      { role: 'user', content: 'alpha bravo charlie delta echo foxtrot golf query' },
    ];
    const kept = compressPrefixByQuery(messages, {
      query: 'alpha bravo charlie delta echo foxtrot golf hotel',
      keepRecentTurns: 1,
    });
    // score ~0.079: the weakly-relevant hotel block survives the 0.04 default
    // by reference, while the old 0.08 default destroyed it.
    expect(kept.messages[0]).toBe(messages[0]);
    const destroyed = compressPrefixByQuery(messages, {
      query: 'alpha bravo charlie delta echo foxtrot golf hotel',
      keepRecentTurns: 1,
      threshold: 0.08,
    });
    expect(destroyed.compressed).toBe(2);
    expect(destroyed.messages[0]).not.toBe(messages[0]);
  });

  it('preview slices on code points: an emoji at the cut never splits into a lone surrogate', () => {
    const messages = [
      { role: 'user', content: '😀'.repeat(10) + ' more text here' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'alpha bravo charlie delta echo foxtrot golf hotel' },
    ];
    const result = compressPrefixByQuery(messages, {
      query: 'alpha bravo charlie delta echo foxtrot golf hotel',
      keepRecentTurns: 1,
      previewChars: 10,
    });
    const placeholder = result.messages[0].content;
    expect(placeholder).toContain('😀'.repeat(10));
    expect(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(placeholder)
    ).toBe(false);
  });
});
