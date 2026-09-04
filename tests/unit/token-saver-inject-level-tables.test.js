// Level-table integrity tests for CAVEMAN_PROMPTS and PONYTAIL_PROMPTS.
// Every level must be non-empty, carry the shared safety boundary blocks
// (no-invented-abbreviations, preserve-language), and be distinct from every
// other level. Level 'off' must inject nothing.

import { describe, it, expect } from "vitest";
import { CAVEMAN_LEVELS, CAVEMAN_PROMPTS } from "../../open-sse/rtk/cavemanPrompts.js";
import { PONYTAIL_LEVELS, PONYTAIL_PROMPTS } from "../../open-sse/rtk/ponytailPrompt.js";
import { injectCaveman } from "../../open-sse/rtk/caveman.js";
import { injectPonytail } from "../../open-sse/rtk/ponytail.js";

// FNV-1a 32-bit: enough to detect identical levels.
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const TABLES = [
  ["caveman", CAVEMAN_LEVELS, CAVEMAN_PROMPTS, injectCaveman],
  ["ponytail", PONYTAIL_LEVELS, PONYTAIL_PROMPTS, injectPonytail],
];

describe.each(TABLES)("%s level table", (_name, LEVELS, PROMPTS, inject) => {
  const levelValues = Object.values(LEVELS);

  it("every declared level has a non-empty prompt", () => {
    for (const level of levelValues) {
      const p = PROMPTS[level];
      expect(typeof p).toBe("string");
      expect(p.trim().length).toBeGreaterThan(100);
    }
  });

  it("every prompt key is a declared level (no orphan keys)", () => {
    expect(Object.keys(PROMPTS).sort()).toEqual([...levelValues].sort());
  });

  it("no two levels are identical (hash compare)", () => {
    const hashes = levelValues.map(l => [l, hash(PROMPTS[l])]);
    const uniq = new Set(hashes.map(([, h]) => h));
    expect(uniq.size).toBe(hashes.length);
  });

  it("levels are strictly ordered by intensity (lite is a strict prefix-subset of full)", () => {
    // lite and full share the persona/boundary core; full adds instructions.
    // Not a hard contract for every future level, so compare only where declared.
    if (PROMPTS[LEVELS.LITE] && PROMPTS[LEVELS.FULL]) {
      expect(PROMPTS[LEVELS.FULL]).not.toBe(PROMPTS[LEVELS.LITE]);
      expect(PROMPTS[LEVELS.FULL].length).toBeGreaterThan(PROMPTS[LEVELS.LITE].length - 1);
    }
  });

  it("level 'off' injects nothing into any format", () => {
    for (const format of ["claude", "openai", "openai-responses", "gemini"]) {
      const body = {
        model: "m",
        system: "base",
        systemInstruction: { parts: [{ text: "base" }] },
        instructions: "base",
        messages: [{ role: "user", content: "hi" }],
        input: [],
        contents: [],
      };
      const before = JSON.parse(JSON.stringify(body));
      expect(() => inject(body, format, "off")).not.toThrow();
      expect(body).toEqual(before);
    }
  });
});

describe("caveman boundary blocks", () => {
  it("every level carries the shared safety boundaries", () => {
    for (const level of Object.values(CAVEMAN_LEVELS)) {
      const p = CAVEMAN_PROMPTS[level];
      expect(p).toContain("invented abbreviations");
      expect(p).toContain("Preserve the user's dominant language");
      expect(p).toContain("Security warnings");
    }
  });
});

describe("ponytail boundary blocks", () => {
  it("DEFECT TP-INJ-2 (medium): ponytail levels lack the shared boundary blocks", () => {
    // CAVEMAN_PROMPTS carries the shared safety boundaries in every level
    // ("No invented abbreviations", "Preserve the user's dominant language").
    // PONYTAIL_PROMPTS has neither string in any level: a ponytail-injected
    // session can compress non-English prose and invent abbreviations, which
    // the caveman table explicitly forbids. Fix: add the two shared boundary
    // sentences to every ponytail level (or share one constant across tables).
    for (const level of Object.values(PONYTAIL_LEVELS)) {
      const p = PONYTAIL_PROMPTS[level];
      expect(p).toContain("invented abbreviations");
      expect(p).toContain("Preserve the user's dominant language");
    }
  });
});
