import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AG from 'open-sse/providers/registry/antigravity.js';
import { getModelUpstreamId, isValidModel } from 'open-sse/config/providerModels.js';

const repoFile = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');

const ids = AG.models.map((m) => m.id);

// "gemini-3.5-flash-high" is a friendly synonym for Antigravity's real model
// key "gemini-3-flash-agent": src/mitm/config.js MODEL_SYNONYMS rewrites it,
// and every other enumeration of this catalog in the tree omits it. Sending it
// upstream verbatim addresses a key Antigravity does not publish.
describe('Antigravity routes its friendly synonym onto the real model key (#2846)', () => {
  it('gemini-3.5-flash-high resolves upstream to gemini-3-flash-agent', () => {
    // chatCore looks models up by ALIAS (handlers/chatCore.js:258 passes `alias`),
    // and PROVIDER_MODELS is keyed by alias only — "ag", never "antigravity".
    expect(getModelUpstreamId('ag', 'gemini-3.5-flash-high')).toBe('gemini-3-flash-agent');
  });

  it('the synonym is still selectable — nothing was removed', () => {
    expect(ids).toContain('gemini-3.5-flash-high');
    expect(isValidModel('ag', 'gemini-3.5-flash-high')).toBe(true);
  });

  it('the real key still routes to itself', () => {
    expect(getModelUpstreamId('ag', 'gemini-3-flash-agent')).toBe('gemini-3-flash-agent');
  });

  it('the mitm synonym map still declares the same mapping', () => {
    expect(repoFile('src/mitm/config.js')).toContain(
      '"gemini-3.5-flash-high": "gemini-3-flash-agent"'
    );
  });

  // The tiered entries carry a "(level)" preset suffix; resolving the plain
  // synonym must not disturb them.
  it('tiered entries keep their preset suffix', () => {
    expect(getModelUpstreamId('ag', 'gemini-3.7-flash-high')).toBe('gemini-3.7-flash-tiered(high)');
    expect(getModelUpstreamId('ag', 'gemini-3.6-flash-low')).toBe('gemini-3.6-flash-tiered(low)');
  });
});
