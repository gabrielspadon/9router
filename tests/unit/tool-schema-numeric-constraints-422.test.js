import { describe, expect, it } from 'vitest';
import '../translator/registerAll.js';
import { translateRequest } from '../../open-sse/translator/index.js';
import { FORMATS } from '../../open-sse/translator/formats.js';

// JSON Schema requires a number for maxLength, minItems and friends. MCP servers
// and hand-written declarations routinely emit them as strings, and a strict
// upstream rejects the whole tool list rather than coercing. A non-string tool
// description fails the same validation (#422, closes #273 / #276).
const tool = (parameters, description = 'd') => ({
  type: 'function',
  function: { name: 'edit', description, parameters },
});

const translated = (parameters, description) =>
  translateRequest(
    FORMATS.OPENAI,
    FORMATS.OPENAI,
    'gpt-5',
    {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [tool(parameters, description)],
    },
    false,
    null,
    'openai'
  ).tools[0].function;

const params = (parameters) => translated(parameters).parameters;

describe('string numeric schema constraints are coerced to numbers (#422)', () => {
  it('coerces a top-level constraint', () => {
    expect(params({ type: 'object', properties: {}, minProperties: '1' }).minProperties).toBe(1);
  });

  it('coerces constraints on a nested property', () => {
    const out = params({
      type: 'object',
      properties: {
        name: { type: 'string', minLength: '1', maxLength: '64' },
        tags: { type: 'array', minItems: '2', maxItems: '10' },
        size: { type: 'number', minimum: '0', maximum: '99.5', multipleOf: '0.5' },
      },
    });

    expect(out.properties.name).toMatchObject({ minLength: 1, maxLength: 64 });
    expect(out.properties.tags).toMatchObject({ minItems: 2, maxItems: 10 });
    expect(out.properties.size).toMatchObject({ minimum: 0, maximum: 99.5, multipleOf: 0.5 });
  });

  it('coerces inside items and composition branches', () => {
    const out = params({
      type: 'object',
      properties: {
        rows: { type: 'array', items: { type: 'string', maxLength: '8' } },
        either: { anyOf: [{ type: 'string', minLength: '3' }, { type: 'number' }] },
      },
    });

    expect(out.properties.rows.items.maxLength).toBe(8);
    expect(out.properties.either.anyOf[0].minLength).toBe(3);
  });

  it('leaves a value that is already a number, and a draft-4 boolean, alone', () => {
    const out = params({
      type: 'object',
      properties: {
        n: { type: 'number', minimum: 5, exclusiveMinimum: true },
      },
    });

    expect(out.properties.n.minimum).toBe(5);
    expect(out.properties.n.exclusiveMinimum).toBe(true);
  });

  it('leaves a non-numeric string alone rather than producing NaN', () => {
    const out = params({
      type: 'object',
      properties: { s: { type: 'string', maxLength: 'lots' } },
    });
    expect(out.properties.s.maxLength).toBe('lots');
  });

  it('guarantees a string description', () => {
    expect(translated({ type: 'object', properties: {} }, { text: 'nope' }).description).toBeTypeOf(
      'string'
    );
  });

  it('does not mutate the caller schema', () => {
    const schema = { type: 'object', properties: { name: { type: 'string', maxLength: '64' } } };
    params(schema);
    expect(schema.properties.name.maxLength).toBe('64');
  });
});
