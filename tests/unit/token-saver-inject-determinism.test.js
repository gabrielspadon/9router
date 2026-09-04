// Determinism / multi-turn / gating tests for the caveman + ponytail system
// injectors (open-sse/rtk/systemInject.js via caveman.js / ponytail.js).
// Cache-critical: identical input must yield a byte-identical body, and a
// re-injection on a later turn must be a no-op (dedup guard).

import { describe, it, expect } from "vitest";
import { injectCaveman } from "../../open-sse/rtk/caveman.js";
import { injectPonytail } from "../../open-sse/rtk/ponytail.js";
import { CAVEMAN_LEVELS, CAVEMAN_PROMPTS } from "../../open-sse/rtk/cavemanPrompts.js";
import { PONYTAIL_LEVELS, PONYTAIL_PROMPTS } from "../../open-sse/rtk/ponytailPrompt.js";

const CLAUDE_BODY = () => ({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  system: "You are a helpful assistant.",
  messages: [{ role: "user", content: "hello" }],
});

const INJECTORS = [
  ["caveman", injectCaveman, CAVEMAN_LEVELS, CAVEMAN_PROMPTS],
  ["ponytail", injectPonytail, PONYTAIL_LEVELS, PONYTAIL_PROMPTS],
];

describe.each(INJECTORS)("%s injector determinism", (_name, inject, LEVELS, PROMPTS) => {
  it("injecting twice at the same level is a byte-identical no-op", () => {
    const b1 = CLAUDE_BODY();
    inject(b1, "claude", LEVELS.FULL);
    const firstPass = JSON.stringify(b1);

    inject(b1, "claude", LEVELS.FULL);
    expect(JSON.stringify(b1)).toBe(firstPass);
    // exactly one injected copy of this level's own prompt text
    expect(b1.system.split(PROMPTS[LEVELS.FULL].trim().slice(0, 100)).length - 1).toBe(1);
  });

  it("re-inject after a new user turn is a no-op (dedup guard fires)", () => {
    const b1 = CLAUDE_BODY();
    inject(b1, "claude", LEVELS.FULL);
    const sysAfterFirst = b1.system;

    const b2 = { ...b1, messages: [...b1.messages, { role: "user", content: "second turn" }] };
    inject(b2, "claude", LEVELS.FULL);
    expect(b2.system).toBe(sysAfterFirst);
    expect(JSON.stringify(b2.messages.slice(0, 1))).toBe(JSON.stringify(b1.messages));
  });

  it("re-inject at a different level: actual behavior, asserted explicitly", () => {
    const b = CLAUDE_BODY();
    inject(b, "claude", LEVELS.LITE);
    const liteSystem = b.system;
    inject(b, "claude", LEVELS.FULL);
    if (_name === "caveman") {
      // caveman levels diverge within the first 100 chars, so full's signature
      // is absent and it is appended: system grows, lite text kept first.
      expect(b.system.startsWith(liteSystem)).toBe(true);
      expect(b.system.length).toBeGreaterThan(liteSystem.length);
    } else {
      // ponytail levels now carry a distinct early marker within the first
      // 100 chars (TP-INJ-3), so full's dedup signature is absent after a
      // lite injection and the escalation lands: system grows, lite kept first.
      expect(b.system.startsWith(liteSystem)).toBe(true);
      expect(b.system.length).toBeGreaterThan(liteSystem.length);
    }
  });

  it("multi-turn: injected text byte-identical across turns (stable prefix for caching)", () => {
    const b1 = CLAUDE_BODY();
    inject(b1, "claude", LEVELS.ULTRA);
    const injected1 = b1.system.slice("You are a helpful assistant.".length);

    const b2 = { ...b1, messages: [...b1.messages, { role: "assistant", content: "a" }, { role: "user", content: "more" }] };
    inject(b2, "claude", LEVELS.ULTRA);
    const injected2 = b2.system.slice("You are a helpful assistant.".length);
    expect(injected2).toBe(injected1);
  });

  it("level 'off' injects nothing and does not throw", () => {
    const b = CLAUDE_BODY();
    expect(() => inject(b, "claude", "off")).not.toThrow();
    expect(b).toEqual(CLAUDE_BODY());
  });

  it("unknown level behaves safely: no throw, no injection", () => {
    const b = CLAUDE_BODY();
    expect(() => inject(b, "claude", "nonsense-level")).not.toThrow();
    expect(b).toEqual(CLAUDE_BODY());
  });
});

describe("DEFECT TP-INJ-3 (medium): ponytail level escalation swallowed by dedup", () => {
  it("ponytail lite then full should land the full instruction", () => {
    // All PONYTAIL_PROMPTS levels begin with the same SHARED_PERSONA +
    // SHARED_LADDER text, longer than the 100-char dedup signature. Injecting
    // full after lite therefore dedups against lite's text and the stronger
    // instruction never lands. Caveman is unaffected (levels diverge earlier).
    // Fix: scope the signature per level or include a level marker near the
    // prompt head.
    const b = CLAUDE_BODY();
    injectPonytail(b, "claude", PONYTAIL_LEVELS.LITE);
    const liteSystem = b.system;
    injectPonytail(b, "claude", PONYTAIL_LEVELS.FULL);
    expect(b.system.length).toBeGreaterThan(liteSystem.length);
  });
});
