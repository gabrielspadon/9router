import { describe, it, expect } from 'vitest';
import {
  CHARS_PER_TOKEN,
  DEFAULT_CONTEXT_WINDOW,
  MEDIA_TOKEN_ESTIMATE,
  estimateRequestTokens,
  measureContextPressure,
  resolveContextBudget,
} from 'open-sse/services/memory/contextBudget.js';
import {
  PRESSURE_TIERS,
  pruneHistoricalTools,
} from 'open-sse/services/memory/toolPruner.js';
import { estimateAnthropicInputTokens } from '@/app/api/v1/messages/count_tokens/route.js';

// The behaviour these tests pin was measured on the RTX seam on 2026-09-04:
// the tool pruner ran on every request against a one-million token window and
// discarded 212 million tokens of history across 5,008 requests in six hours,
// median 29,000 per request. Sessions plateaued near 350,000 tokens because
// the pruner would not let them grow.

const toolTurn = (id, chars) => ({
  role: 'tool',
  tool_call_id: id,
  content: 'x'.repeat(chars),
});
const callTurn = (id) => ({
  role: 'assistant',
  content: 'calling',
  tool_calls: [{ id, function: { name: 'read' } }],
});

/** A session with `n` tool turns of `chars` each, in call/result pairs. */
function session(n, chars) {
  const messages = [{ role: 'user', content: 'start' }];
  for (let i = 0; i < n; i += 1) {
    messages.push(callTurn(`t${i}`), toolTurn(`t${i}`, chars));
  }
  messages.push({ role: 'user', content: 'and now?' });
  return { messages };
}

describe('contextBudget: the window is a budget, not a suggestion', () => {
  it('holds back a reserve and never spends the whole window', () => {
    const { limit, reserve, budget } = resolveContextBudget({ contextWindow: 1_000_000 });
    expect(limit).toBe(1_000_000);
    // 5% of a megatoken, which is what the reply and the client's own
    // compaction pass have to fit inside.
    expect(reserve).toBe(50_000);
    expect(budget).toBe(950_000);
  });

  it('never lets a small window produce a reserve one reply would overrun', () => {
    // 5% of 16k is 800 tokens. One answer is bigger than that, so the floor
    // applies and the budget falls back to half the window rather than going
    // negative.
    const { reserve, budget } = resolveContextBudget({ contextWindow: 16_000 });
    expect(reserve).toBe(8_000);
    expect(budget).toBe(8_000);
  });

  it('falls back to the engine default rather than assuming a megatoken', () => {
    expect(resolveContextBudget({}).limit).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(resolveContextBudget({ contextWindow: 0 }).limit).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(resolveContextBudget({ contextWindow: 'nonsense' }).limit).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it('lets the operator override the window and the reserve', () => {
    const b = resolveContextBudget({
      contextWindow: 1_000_000,
      settings: { memoryContextWindowOverride: 400_000, memoryContextReserveFraction: 0.2 },
    });
    expect(b.limit).toBe(400_000);
    expect(b.reserve).toBe(80_000);
    expect(b.budget).toBe(320_000);
  });

  it('refuses a reserve fraction that would prune a conversation that fits', () => {
    // Half the window or more is a misconfiguration, not a policy.
    const b = resolveContextBudget({
      contextWindow: 1_000_000,
      settings: { memoryContextReserveFraction: 0.9 },
    });
    expect(b.reserve).toBe(50_000);
  });

  it('aims BELOW the trigger so one prune does not re-fire next turn', () => {
    // Pruning back to exactly the trigger means the next turn lands one token
    // over it and prunes again, and every re-prune rewrites the prefix and
    // invalidates the provider's cache. The relief margin is what buys a
    // stretch of byte-stable turns per prune.
    const { budget, target } = resolveContextBudget({ contextWindow: 1_000_000 });
    expect(target).toBeLessThan(budget);
    expect(target).toBe(855_000);
  });

  it('charges a media block flat instead of by its encoded length', () => {
    // A megabyte of base64 is ~1,400,000 characters and ~1,600 tokens.
    const base64 = 'A'.repeat(1_400_000);
    const withImage = {
      messages: [
        { role: 'user', content: [{ type: 'image', source: { type: 'base64', data: base64 } }] },
      ],
    };
    const tokens = estimateRequestTokens(withImage);
    // Counted by length this was ~368,000 tokens, which on its own reads as a
    // third of a megatoken window spent on one screenshot.
    expect(tokens).toBeLessThan(MEDIA_TOKEN_ESTIMATE * 2);
    expect(tokens).toBeGreaterThan(MEDIA_TOKEN_ESTIMATE / 2);
  });

  it('counts instructions and tools, not only the conversation', () => {
    const body = {
      system: 'y'.repeat(3_800),
      tools: [{ name: 'read', description: 'z'.repeat(3_800) }],
      messages: [{ role: 'user', content: 'hi' }],
    };
    // ~1,000 tokens of system plus ~1,000 of tools, which a
    // conversation-only estimate would have missed entirely.
    expect(estimateRequestTokens(body)).toBeGreaterThan(1_900);
  });
});

describe('toolPruner: nothing happens while the request fits', () => {
  it('leaves a whole session untouched inside the budget', () => {
    // Twenty tool turns of 5,000 characters is ~26,000 tokens: nothing at all
    // against a megatoken window, and exactly the traffic the old flat pruner
    // was cutting 29,000 tokens out of on every single request.
    const body = session(20, 5_000);
    const before = JSON.stringify(body);
    const pressure = measureContextPressure(body, { contextWindow: 1_000_000 });

    expect(pressure.over).toBe(false);
    const res = pruneHistoricalTools(body, {
      budgetAware: true,
      deficitChars: pressure.deficitChars,
    });
    expect(res.pruned).toBe(false);
    expect(JSON.stringify(body)).toBe(before);
  });

  it('keeps the flat path for a caller that never measured', () => {
    // Not every caller has been taught about budgets, and the ones that have
    // not must keep working rather than silently stop pruning.
    const body = session(6, 5_000);
    const res = pruneHistoricalTools(body, { maxHistoricalChars: 800, keepRecentTurns: 2 });
    expect(res.pruned).toBe(true);
    expect(body.messages[2].content.length).toBeLessThan(1_200);
  });
});

describe('toolPruner: pressure is progressive and stops when it is enough', () => {
  // A session that genuinely overruns a 200k window: 60 tool turns of 20,000
  // characters is ~316,000 tokens.
  const overrun = () => session(60, 20_000);

  it('trims the OLDEST turns and leaves the recent working set whole', () => {
    const body = overrun();
    const pressure = measureContextPressure(body, { contextWindow: 200_000 });
    expect(pressure.over).toBe(true);

    pruneHistoricalTools(body, { budgetAware: true, deficitChars: pressure.deficitChars });

    const toolLengths = body.messages
      .filter((m) => m.role === 'tool')
      .map((m) => m.content.length);
    // The last twenty tool turns are the protected working set.
    const recent = toolLengths.slice(-20);
    expect(recent.every((n) => n === 20_000)).toBe(true);
    // Something older gave way.
    expect(toolLengths.slice(0, 40).some((n) => n < 20_000)).toBe(true);
  });

  it('stops as soon as the overflow is covered rather than cutting everything', () => {
    const body = overrun();
    const pressure = measureContextPressure(body, { contextWindow: 200_000 });
    const res = pruneHistoricalTools(body, {
      budgetAware: true,
      deficitChars: pressure.deficitChars,
    });

    // Enough was found.
    expect(res.savedChars).toBeGreaterThanOrEqual(pressure.deficitChars);
    // And barely more than enough. The old pruner cut every one of the 40
    // historical turns to 800 characters — over 750,000 characters — whatever
    // the request actually needed.
    expect(res.savedChars).toBeLessThan(pressure.deficitChars * 1.2);

    // The walk ended PART WAY through a tier, which is what "as little as
    // possible" looks like from the outside: the oldest turns took the tighter
    // cap and the ones after them kept the gentler one.
    const historical = body.messages
      .filter((m) => m.role === 'tool')
      .map((m) => m.content.length)
      .slice(0, 40);
    expect(historical.some((n) => n < 5_000)).toBe(true);
    expect(historical.some((n) => n > 5_000)).toBe(true);
  });

  it('uses only the gentlest tier it needs, and escalates when it must', () => {
    // Turns bigger than the first cap, so the first cap can actually bite.
    // The walk is age-major: the oldest result is cut to the gentlest cap
    // that covers what is owed, so a deficit the first cap covers on one
    // result reaches nothing tighter and touches nothing newer.
    const small = session(60, 30_000);
    const smallRes = pruneHistoricalTools(small, {
      budgetAware: true,
      deficitChars: 8_000,
    });
    expect(smallRes.tiersUsed).toBe(1);
    expect(smallRes.savedChars).toBeGreaterThanOrEqual(8_000);
    // One turn was enough, so every other historical turn is whole.
    const whole = small.messages
      .filter((m) => m.role === 'tool')
      .filter((m) => m.content.length === 30_000).length;
    expect(whole).toBeGreaterThan(50);

    // An overflow the generous cap cannot cover walks into the tighter ones.
    const big = session(60, 30_000);
    const bigRes = pruneHistoricalTools(big, {
      budgetAware: true,
      deficitChars: 60 * 30_000,
    });
    expect(bigRes.tiersUsed).toBeGreaterThan(1);
    expect(bigRes.tiersUsed).toBeLessThanOrEqual(PRESSURE_TIERS.length);
  });

  it('reports what it could not find instead of eating the protected turns', () => {
    const body = session(3, 500);
    const res = pruneHistoricalTools(body, {
      budgetAware: true,
      deficitChars: 5_000_000,
      keepRecentTurns: 20,
    });
    // Every tool turn is inside the protected window, so nothing is cut and
    // the caller is told the overflow survived.
    expect(res.pruned).toBe(false);
  });
});

describe('count_tokens: a client decides when to compact from this number', () => {
  it('does not report a screenshot as a third of a megatoken window', () => {
    const base64 = 'A'.repeat(1_400_000);
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is in this?' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
          ],
        },
      ],
    };
    const tokens = estimateAnthropicInputTokens(body);
    // Length-counted this returned ~350,000. Two of these in a conversation
    // told the client its window was full, and the client compacted at once.
    expect(tokens).toBeLessThan(4_000);
  });

  it('charges an image nested inside a tool_result flat too', () => {
    const base64 = 'A'.repeat(1_400_000);
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'x',
              content: [{ type: 'image', source: { type: 'base64', data: base64 } }],
            },
          ],
        },
      ],
    };
    expect(estimateAnthropicInputTokens(body)).toBeLessThan(4_000);
  });

  it('still counts text, system and tools the way it always did', () => {
    const body = {
      system: 'a'.repeat(400),
      tools: [{ name: 'read' }],
      messages: [{ role: 'user', content: 'b'.repeat(400) }],
    };
    const tokens = estimateAnthropicInputTokens(body);
    expect(tokens).toBeGreaterThan(190);
    expect(tokens).toBeLessThan(240);
  });
});

describe('contextBudget: the estimator is honest about its own units', () => {
  it('assumes fewer characters per token than prose, because this is code', () => {
    expect(CHARS_PER_TOKEN).toBeLessThan(4);
    expect(CHARS_PER_TOKEN).toBeGreaterThan(3);
  });
});
