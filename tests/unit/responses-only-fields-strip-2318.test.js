import { describe, expect, it } from 'vitest';
import '../translator/registerAll.js';
import { translateRequest } from '../../open-sse/translator/index.js';
import { FORMATS } from '../../open-sse/translator/formats.js';

// openaiResponsesToOpenAIRequest builds its result by spreading the incoming
// body, so every Responses-only field it does not explicitly delete rides
// through to a Chat Completions upstream. `client_metadata` was already
// deleted; `background` and `truncation` were not, and a non-OpenAI provider
// (NVIDIA NIM behind a combo) answers 400 "Unsupported parameter(s)" (#2318).
const convert = (extra) =>
  translateRequest(
    FORMATS.OPENAI_RESPONSES,
    FORMATS.OPENAI,
    'z-ai/glm-5.2',
    { model: 'z-ai/glm-5.2', input: 'hi', ...extra },
    false,
    null,
    'nvidia'
  );

describe('Responses-API-only fields never reach a Chat Completions upstream (#2318)', () => {
  it.each(['client_metadata', 'background', 'truncation'])('strips %s', (field) => {
    const out = convert({ [field]: field === 'client_metadata' ? { user_id: 'u1' } : 'auto' });
    expect(out[field]).toBeUndefined();
  });

  it('still strips the fields that were already handled', () => {
    const out = convert({ store: true, include: ['x'], prompt_cache_key: 'k' });
    for (const field of ['input', 'store', 'include', 'prompt_cache_key']) {
      expect(out[field], field).toBeUndefined();
    }
  });

  it('keeps the converted messages and unrelated sampling fields', () => {
    const out = convert({ background: true, temperature: 0.4, max_tokens: 128 });
    expect(out.messages?.[0]?.content).toBeTruthy();
    expect(out.temperature).toBe(0.4);
    expect(out.max_tokens).toBe(128);
  });
});
