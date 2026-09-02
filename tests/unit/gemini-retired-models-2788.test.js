import { describe, expect, it } from 'vitest';
import GEMINI from 'open-sse/providers/registry/gemini.js';
import { isValidModel } from 'open-sse/config/providerModels.js';

const ids = GEMINI.models.map((m) => m.id);

// Google's own deprecation table (ai.google.dev/gemini-api/docs/deprecations,
// read 2026-08-31) is the specification here: an id whose published shutdown
// date has passed cannot answer, so offering it in the catalog guarantees a
// failure at call time.
const SHUT_DOWN = {
  'gemini-3.1-flash-lite-preview': '2026-05-25',
  'gemini-3.1-flash-image-preview': '2026-06-25',
  'gemini-3-pro-image-preview': '2026-06-25',
  'text-embedding-004': '2026-01-14',
  'embedding-001': '2025-10-30',
  'gemini-2.0-flash': '2026-06-01',
};

// Google's own "recommended replacement" column for the ids above.
const REPLACEMENTS = [
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
  'gemini-embedding-2',
  'gemini-3.6-flash',
];

describe('Gemini catalog carries no id Google has already shut down (#2788)', () => {
  for (const [id, shutdown] of Object.entries(SHUT_DOWN)) {
    it(`${id} (shut down ${shutdown}) is gone`, () => {
      expect(ids).not.toContain(id);
      expect(isValidModel('gemini', id)).toBe(false);
    });
  }

  for (const id of REPLACEMENTS) {
    it(`${id} is offered in its place`, () => {
      expect(ids).toContain(id);
      expect(isValidModel('gemini', id)).toBe(true);
    });
  }

  // The report claimed gemini-2.5-flash is "no longer available". Google's
  // deprecation page lists it with NO shutdown date announced, as it does
  // gemini-2.5-pro and gemini-2.5-flash-lite, so removing them would have
  // dropped three live models. This pins that they stay.
  for (const id of ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite']) {
    it(`${id} is kept — Google announces no shutdown date for it`, () => {
      expect(ids).toContain(id);
      expect(isValidModel('gemini', id)).toBe(true);
    });
  }

  it('the STT list still offers a live model per tier', () => {
    const stt = GEMINI.models.filter((m) => m.kind === 'stt').map((m) => m.id);
    expect(stt).toContain('gemini-3.6-flash');
    expect(stt).not.toContain('gemini-2.0-flash');
  });

  it('every image entry is a GA id, not a retired preview', () => {
    const image = GEMINI.models.filter((m) => m.kind === 'image').map((m) => m.id);
    expect(image.some((id) => id.endsWith('-preview'))).toBe(false);
  });
});
