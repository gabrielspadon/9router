import { describe, it, expect } from 'vitest';
import {
  compileCustomAdapter,
  adapterFromProviderNode,
  normalizeAdapterBaseUrl,
} from 'open-sse/providers/customAdapters.js';
import { resolveTransport } from 'open-sse/services/provider.js';

const ID = 'openai-compatible-adapter-test';

function valid(extra = {}) {
  return {
    name: 'Internal Gateway',
    prefix: 'igw',
    baseUrl: 'https://gw.internal.example/v1',
    ...extra,
  };
}

describe('custom adapter compilation (#3356)', () => {
  it('compiles a minimal document into an executable provider node', () => {
    const { errors, node } = compileCustomAdapter(valid(), { id: ID });
    expect(errors).toEqual([]);
    expect(node).toMatchObject({
      id: ID,
      type: 'openai-compatible',
      prefix: 'igw',
      apiType: 'chat',
      baseUrl: 'https://gw.internal.example/v1',
    });
    expect(node.transports).toEqual([
      {
        format: 'openai',
        baseUrl: 'https://gw.internal.example/v1/chat/completions',
        auth: { combined: true, header: 'Authorization', scheme: 'bearer' },
      },
    ]);
  });

  it('keeps the openai-compatible id prefix, which is what carries transports to the executor', () => {
    const { node } = compileCustomAdapter(valid(), { id: ID });
    expect(node.id.startsWith('openai-compatible-')).toBe(true);
  });

  it("derives the canonical path per declared format and attaches the format's auth", () => {
    const { errors, node } = compileCustomAdapter(
      valid({
        endpoints: [{ format: 'openai' }, { format: 'claude' }, { format: 'openai-responses' }],
      }),
      { id: ID }
    );
    expect(errors).toEqual([]);
    expect(node.transports.map((t) => t.baseUrl)).toEqual([
      'https://gw.internal.example/v1/chat/completions',
      'https://gw.internal.example/v1/messages',
      'https://gw.internal.example/v1/responses',
    ]);
    expect(node.transports[1].auth).toEqual({
      combined: true,
      header: 'x-api-key',
      scheme: 'raw',
      anthropicVersion: true,
    });
  });

  it('carries static headers onto every transport', () => {
    const { node } = compileCustomAdapter(
      valid({
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)', 'X-Tenant': 'acme' },
        endpoints: [{ format: 'openai' }, { format: 'claude' }],
      }),
      { id: ID }
    );
    for (const transport of node.transports) {
      expect(transport.headers).toEqual({
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)',
        'X-Tenant': 'acme',
      });
    }
  });

  it('honours an explicit auth header and scheme', () => {
    const { node } = compileCustomAdapter(
      valid({ auth: { header: 'X-Gateway-Key', scheme: 'raw' } }),
      { id: ID }
    );
    expect(node.transports[0].auth).toEqual({
      combined: true,
      header: 'X-Gateway-Key',
      scheme: 'raw',
    });
  });

  it('accepts a per-endpoint url and a urlSuffix', () => {
    const { errors, node } = compileCustomAdapter(
      valid({
        endpoints: [
          { format: 'openai', url: 'https://edge.example/openai/chat', urlSuffix: '?beta=true' },
        ],
      }),
      { id: ID }
    );
    expect(errors).toEqual([]);
    expect(node.transports[0]).toMatchObject({
      baseUrl: 'https://edge.example/openai/chat',
      urlSuffix: '?beta=true',
    });
  });

  it('normalizes a base URL pasted with its canonical path', () => {
    expect(normalizeAdapterBaseUrl('https://x.example/v1/chat/completions')).toBe(
      'https://x.example/v1'
    );
    expect(normalizeAdapterBaseUrl('https://x.example/v1/')).toBe('https://x.example/v1');
  });
});

describe('custom adapters refuse executable content (#3356)', () => {
  for (const field of [
    'requestTransformer',
    'responseTransformer',
    'streamTransformer',
    'script',
    'hooks',
  ]) {
    it(`rejects "${field}" rather than loading it`, () => {
      const { errors, node } = compileCustomAdapter(
        valid({ [field]: 'module.exports = (b) => b' }),
        { id: ID }
      );
      expect(node).toBeNull();
      expect(errors.join(' ')).toContain(field);
      expect(errors.join(' ')).toContain('data, not code');
    });
  }

  it('rejects a function-valued field', () => {
    const { errors, node } = compileCustomAdapter(valid({ mapBody: () => ({}) }), { id: ID });
    expect(node).toBeNull();
    expect(errors.join(' ')).toContain('executable');
  });

  it('rejects an environment interpolation in a header value', () => {
    const { errors, node } = compileCustomAdapter(
      valid({ headers: { 'X-Key': '${JWT_SECRET}' } }),
      { id: ID }
    );
    expect(node).toBeNull();
    expect(errors.join(' ')).toContain('environment interpolation');
  });
});

describe('custom adapter input validation (#3356)', () => {
  it('rejects a header value carrying CR or LF', () => {
    const { errors, node } = compileCustomAdapter(
      valid({ headers: { 'X-Evil': 'a\r\nX-Injected: 1' } }),
      { id: ID }
    );
    expect(node).toBeNull();
    expect(errors.join(' ')).toContain('newline');
  });

  it('rejects a header name that is not an HTTP token', () => {
    const { node, errors } = compileCustomAdapter(valid({ headers: { 'X Bad': 'v' } }), { id: ID });
    expect(node).toBeNull();
    expect(errors.join(' ')).toContain('HTTP token');
  });

  it('rejects framing headers', () => {
    const { node } = compileCustomAdapter(valid({ headers: { 'Content-Length': '5' } }), {
      id: ID,
    });
    expect(node).toBeNull();
  });

  it('rejects a non-http(s) base URL', () => {
    for (const baseUrl of ['file:///etc/passwd', 'ftp://x.example', 'not-a-url', '']) {
      const { node } = compileCustomAdapter(valid({ baseUrl }), { id: ID });
      expect(node).toBeNull();
    }
  });

  it('rejects a prefix with a slash, which would break prefix/model routing', () => {
    const { node } = compileCustomAdapter(valid({ prefix: 'a/b' }), { id: ID });
    expect(node).toBeNull();
  });

  it('rejects a prefix already owned by another node', () => {
    const { node, errors } = compileCustomAdapter(valid(), {
      id: ID,
      takenPrefixes: ['igw'],
    });
    expect(node).toBeNull();
    expect(errors.join(' ')).toContain('already used');
  });

  it('rejects an unknown or duplicated endpoint format', () => {
    expect(
      compileCustomAdapter(valid({ endpoints: [{ format: 'gemini' }] }), { id: ID }).node
    ).toBeNull();
    expect(
      compileCustomAdapter(valid({ endpoints: [{ format: 'openai' }, { format: 'openai' }] }), {
        id: ID,
      }).node
    ).toBeNull();
  });

  it('rejects a non-object document', () => {
    for (const doc of [null, 'x', 3, []]) {
      expect(compileCustomAdapter(doc, { id: ID }).node).toBeNull();
    }
  });
});

describe('compiled adapters are what the engine already routes (#3356)', () => {
  it("resolveTransport picks the compiled transport for the client's source format", () => {
    const { node } = compileCustomAdapter(
      valid({
        headers: { 'X-Tenant': 'acme' },
        endpoints: [{ format: 'openai' }, { format: 'claude' }],
      }),
      { id: ID }
    );
    const credentials = { providerSpecificData: { transports: node.transports } };

    const claude = resolveTransport(node.id, 'claude', credentials);
    expect(claude.baseUrl).toBe('https://gw.internal.example/v1/messages');
    expect(claude.headers['X-Tenant']).toBe('acme');
    expect(claude.auth.header).toBe('x-api-key');

    const openai = resolveTransport(node.id, 'openai', credentials);
    expect(openai.baseUrl).toBe('https://gw.internal.example/v1/chat/completions');

    // A format the adapter did not declare has no transport, so the request
    // falls back to the node's own baseUrl and the built-in headers.
    expect(resolveTransport(node.id, 'gemini', credentials)).toBeNull();
  });

  it('round-trips a stored node back into an importable document', () => {
    const { node } = compileCustomAdapter(
      valid({
        headers: { 'X-Tenant': 'acme' },
        auth: { header: 'X-Gateway-Key', scheme: 'raw' },
        endpoints: [{ format: 'openai' }, { format: 'claude' }],
      }),
      { id: ID }
    );
    const doc = adapterFromProviderNode(node);
    const recompiled = compileCustomAdapter(doc, { id: ID });
    expect(recompiled.errors).toEqual([]);
    expect(recompiled.node.transports).toEqual(node.transports);
  });
});
