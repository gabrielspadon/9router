import { describe, it, expect } from 'vitest';
import { applyMemoryEnhancements } from 'open-sse/services/memory/index.js';
import { estimateRequestTokens, measureContextPressure, resolveContextBudget, CHARS_PER_TOKEN } from 'open-sse/services/memory/contextBudget.js';
import { buildSession, turnBodies } from '../qa/saver-audit/fixture.mjs';

function longestCommonPrefixLength(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

describe('tool pruner prefix stability', () => {
  it('prunes as a monotone, idempotent prefix rewrite', async () => {
    const session = buildSession({ seed: 7, rounds: 16, toolCount: 64 });
    const bodies = turnBodies(session);
    const settings = { memoryMaxToolTurnsKeepFull: 4 };
    const targetFormat = 'claude';

    const lastBody = bodies[bodies.length - 1].body;
    const est = estimateRequestTokens(lastBody);
    const contextWindow = Math.round(Math.max(est * 0.6 + 8000, (est * 0.6) / 0.95));

    const runs = [];
    for (const { body } of bodies) {
      const result = await applyMemoryEnhancements(structuredClone(body), {
        settings,
        targetFormat,
        contextWindow,
      });
      // The relief chunk the ladder quantizes its deficit to: two requests
      // inside the same chunk must produce the same cuts, so the historical
      // prefix only ever moves when the chunk index steps up.
      const pressure = measureContextPressure(body, { settings, contextWindow });
      const budget = resolveContextBudget({ contextWindow, settings });
      const chunk = Math.ceil((budget.budget - budget.target) * CHARS_PER_TOKEN);
      // The protected window ages results out in batches of half its size;
      // a batch boundary is the other event that may move the prefix.
      const toolTurns = body.messages.filter((m) => Array.isArray(m.content) && m.content.some((b) => b?.type === 'tool_result')).length;
      const step = Math.max(1, Math.floor(settings.memoryMaxToolTurnsKeepFull / 2));
      runs.push({
        over: result.stats.budget.over,
        overAfter: result.stats.budget.overAfter,
        batchIndex: Math.floor(Math.max(0, toolTurns - settings.memoryMaxToolTurnsKeepFull) / step),
        chunkIndex: Math.ceil(pressure.deficitChars / chunk),
        serialized: JSON.stringify(result.body.messages),
        messages: result.body.messages,
      });
    }

    // 1. Monotone prefix across consecutive over-budget turns.
    let prefixViolation = false;
    let rewrites = 0;
    let chunkSteps = 0;
    let overTransitions = 0;
    for (let t = 0; t < runs.length - 1; t++) {
      if (!runs[t].over || !runs[t + 1].over) continue;
      overTransitions++;
      const serT = runs[t].serialized;
      const serT1 = runs[t + 1].serialized;
      const lcp = longestCommonPrefixLength(serT, serT1);
      const threshold = JSON.stringify(runs[t].messages.slice(0, -2)).length;
      // A request the ladder cannot fit (overAfter) has its walk reach the
      // newest historical result every turn; that cut is unavoidable and is
      // reported by the ladder itself, so it is not a stability violation.
      const stepped = runs[t + 1].chunkIndex !== runs[t].chunkIndex || runs[t + 1].batchIndex !== runs[t].batchIndex || runs[t].overAfter || runs[t + 1].overAfter;
      const fraction = serT.length ? (lcp / serT.length).toFixed(3) : 'n/a';
      console.log(`turn ${t}->${t + 1}: lcp=${lcp} threshold=${threshold} fraction=${fraction} chunk=${runs[t].chunkIndex}->${runs[t + 1].chunkIndex} batch=${runs[t].batchIndex}->${runs[t + 1].batchIndex} overAfter=${runs[t].overAfter}->${runs[t + 1].overAfter}`);
      if (stepped) chunkSteps++;
      if (lcp < threshold) {
        rewrites++;
        if (!stepped) prefixViolation = true;
      }
    }
    expect(overTransitions).toBeGreaterThan(3);
    // A rewrite is allowed only when the deficit crossed into a new chunk.
    expect(prefixViolation).toBe(false);
    expect(rewrites).toBeLessThanOrEqual(chunkSteps);
    // And the quantization must actually buy stable turns.
    expect(rewrites).toBeLessThan(overTransitions);

    // 2. Fixed point: re-applying to the pruner's own output changes nothing.
    let fixedPointViolation = false;
    for (let t = 0; t < runs.length; t++) {
      // Only where the ladder fit the request: an output still over budget
      // is sent as-is and promises no fixed point.
      if (runs[t].overAfter) continue;
      const second = await applyMemoryEnhancements(
        structuredClone({ ...bodies[t].body, messages: runs[t].messages }),
        {
          settings,
          targetFormat,
          contextWindow,
        }
      );
      const secondSerialized = JSON.stringify(second.body.messages);
      if (secondSerialized !== runs[t].serialized) {
        fixedPointViolation = true;
        const delta = Math.abs(secondSerialized.length - runs[t].serialized.length);
        console.log(`turn ${t}: fixed-point byte delta=${delta}`);
      }
    }
    expect(fixedPointViolation).toBe(false);
  });
});
