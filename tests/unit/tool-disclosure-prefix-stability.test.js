import { describe, it, expect } from 'vitest';
import { disclosureTools } from 'open-sse/utils/toolDisclosure.js';
import { buildSession, turnBodies } from '../qa/saver-audit/fixture.mjs';

// Anthropic hashes the prompt prefix in order tools, system, messages, so any
// change to the selected tool list invalidates the whole cache. The disclosed
// tool list must therefore grow append-only across turns: never drop a
// previously disclosed tool, never reorder it.
describe('tool disclosure prefix stability', () => {
  it("keeps turn t's tool order as a prefix of turn t+1's", () => {
    const session = buildSession({ seed: 7, rounds: 16, toolCount: 64 });
    const bodies = turnBodies(session);
    const connectionId = 'sess-A';
    const maxTools = 24;

    let prevNames = null;
    let anyViolation = false;

    bodies.forEach(({ body }, turn) => {
      const { tools: selected } = disclosureTools(session.tools, body, connectionId, { maxTools });
      const names = selected.map((t) => t.name);

      if (prevNames) {
        let changed = 0;
        for (let i = 0; i < prevNames.length; i++) {
          if (names[i] !== prevNames[i]) changed++;
        }
        // Any previously disclosed name absent from the new list also counts.
        const nameSet = new Set(names);
        const dropped = prevNames.filter((n) => !nameSet.has(n)).length;
        console.log(`turn ${turn}: ${changed} positions changed, ${dropped} dropped`);

        const isPrefix = prevNames.every((n, i) => names[i] === n);
        if (!isPrefix) anyViolation = true;
      }
      prevNames = names;
    });

    expect(anyViolation).toBe(false);
  });
});
