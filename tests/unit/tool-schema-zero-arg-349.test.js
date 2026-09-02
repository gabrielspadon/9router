import { describe, expect, it } from 'vitest';
import '../translator/registerAll.js';
import { translateRequest } from '../../open-sse/translator/index.js';
import { FORMATS } from '../../open-sse/translator/formats.js';

// Strict OpenAI/Codex function validation rejects an object schema carrying no
// `properties` with "object schema missing properties". Zero-argument MCP tools
// declare exactly `{ type: "object" }`, and the same shape appears nested inside
// a larger schema, where the top-level-only normalizers never reached (#349).
const tool = (parameters) => ({
  type: 'function',
  function: { name: 'noop', description: 'does nothing', parameters },
});

const toOpenAI = (parameters) =>
  translateRequest(
    FORMATS.OPENAI,
    FORMATS.OPENAI,
    'gpt-5',
    { model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }], tools: [tool(parameters)] },
    false,
    null,
    'openai'
  ).tools[0].function.parameters;

const toResponses = (parameters) =>
  translateRequest(
    FORMATS.OPENAI,
    FORMATS.OPENAI_RESPONSES,
    'gpt-5',
    { model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }], tools: [tool(parameters)] },
    false,
    null,
    'codex'
  ).tools[0].parameters;

describe('a zero-argument object schema is strict-compatible (#349)', () => {
  it('fills properties on an OpenAI-format tool that already reached us as one', () => {
    expect(toOpenAI({ type: 'object' }).properties).toEqual({});
  });

  it('fills properties on a nested object schema', () => {
    const out = toOpenAI({
      type: 'object',
      properties: { opts: { type: 'object' } },
    });
    expect(out.properties.opts.properties).toEqual({});
  });

  it('fills properties inside items and composition branches', () => {
    const out = toOpenAI({
      type: 'object',
      properties: {
        rows: { type: 'array', items: { type: 'object' } },
        either: { anyOf: [{ type: 'object' }, { type: 'string' }] },
      },
    });
    expect(out.properties.rows.items.properties).toEqual({});
    expect(out.properties.either.anyOf[0].properties).toEqual({});
  });

  it('reaches the Responses API target, which is where Codex validates', () => {
    const out = toResponses({ type: 'object', properties: { opts: { type: 'object' } } });
    expect(out.properties.opts.properties).toEqual({});
  });

  it('leaves a non-object schema without properties', () => {
    const out = toOpenAI({ type: 'object', properties: { tags: { type: 'array' } } });
    expect(out.properties.tags.properties).toBeUndefined();
  });

  it('leaves a well-formed schema untouched and does not mutate the caller', () => {
    const good = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] };
    const frozen = JSON.stringify(good);
    expect(toOpenAI(good)).toEqual(good);
    // A combo hands the same body to each member in turn.
    expect(JSON.stringify(good)).toBe(frozen);
  });

  it('does not mutate a caller schema it did have to fix', () => {
    const bad = { type: 'object', properties: { opts: { type: 'object' } } };
    toOpenAI(bad);
    expect(bad.properties.opts.properties).toBeUndefined();
  });
});
