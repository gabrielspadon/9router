/**
 * Unit tests for DefaultExecutor.defaultResponsesTextFormat (issue #2093).
 *
 * OpenAI-compatible providers configured with API Type "responses" route the
 * client request to /v1/responses. When the client sends a `text` object that
 * omits `text.format` (e.g. `{ verbosity: "medium" }`), some Responses-compatible
 * upstreams (LM Studio) reject it with 400 missing_required_parameter for
 * `text.format`. The Responses API default for that field is { type: "text" },
 * so the executor defaults it before forwarding. These tests lock that behavior
 * and guard that it stays scoped to openai-compatible responses providers.
 */
import { describe, it, expect } from 'vitest';
import { DefaultExecutor } from '../../open-sse/executors/default.js';

function run(provider, body, credentials) {
  const executor = new DefaultExecutor(provider);
  return executor.transformRequest('some-model', body, undefined, credentials);
}

const RESPONSES_PROVIDER = 'openai-compatible-responses-1234';
const CHAT_PROVIDER = 'openai-compatible-chat-1234';

describe('DefaultExecutor: default text.format for openai-compatible responses (#2093)', () => {
  it('defaults text.format when persisted API type overrides a chat-shaped provider id', () => {
    const out = run(
      CHAT_PROVIDER,
      { input: 'Say OK', text: { verbosity: 'low' } },
      { providerSpecificData: { apiType: 'responses' } },
    );

    expect(out.text).toEqual({ verbosity: 'low', format: { type: 'text' } });
  });

  it("defaults text.format to { type: 'text' } when text is an object without format", () => {
    const out = run(RESPONSES_PROVIDER, { input: 'Say OK', text: { verbosity: 'medium' } });
    expect(out.text).toEqual({ verbosity: 'medium', format: { type: 'text' } });
  });

  it('preserves an existing text.format instead of overwriting it', () => {
    const fmt = { type: 'json_schema', name: 'x', schema: { type: 'object' } };
    const out = run(RESPONSES_PROVIDER, {
      input: 'Say OK',
      text: { verbosity: 'low', format: fmt },
    });
    expect(out.text.format).toBe(fmt);
  });

  it('does nothing when there is no text object', () => {
    const out = run(RESPONSES_PROVIDER, { input: 'Say OK' });
    expect(out.text).toBeUndefined();
  });

  it('does not touch a non-responses openai-compatible (chat) provider', () => {
    const out = run(CHAT_PROVIDER, {
      messages: [{ role: 'user', content: 'hi' }],
      text: { verbosity: 'medium' },
    });
    expect(out.text).toEqual({ verbosity: 'medium' });
  });

  it('does not default text.format when persisted chat API type overrides a responses-shaped id', () => {
    const out = run(
      RESPONSES_PROVIDER,
      { messages: [{ role: 'user', content: 'hi' }], text: { verbosity: 'medium' } },
      { providerSpecificData: { apiType: 'chat' } },
    );

    expect(out.text).toEqual({ verbosity: 'medium' });
  });

  it('ignores a non-object text value', () => {
    const out = run(RESPONSES_PROVIDER, { input: 'Say OK', text: 'plain' });
    expect(out.text).toBe('plain');
  });
});
