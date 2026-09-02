import { describe, it, expect } from 'vitest';
import { createPassthroughStreamWithLogger } from '../../open-sse/utils/stream.js';

// PR 3611 port (passthrough slice): dedupe duplicate finish/[DONE] terminators,
// normalize delta.reasoning -> reasoning_content, and newline-terminate the
// trailing flush frame. All target AI SDK "content after finish reason" and
// reasoning-rendered-as-empty failures seen with stealth/ox-alpha gateways.
const encoder = new TextEncoder();

async function pump(chunks, provider = 'openai', model = 'gpt-4o') {
  const stream = createPassthroughStreamWithLogger(
    provider,
    null,
    model,
    'conn-1',
    { model },
    null
  );
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  let out = '';
  const drain = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
  })();
  for (const c of chunks) await writer.write(encoder.encode(c));
  await writer.close();
  await drain;
  return out;
}

const FINISH =
  'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n';

describe('passthrough dedupe/normalization (PR 3611)', () => {
  it('drops a duplicated finish chunk', async () => {
    const out = await pump(['data: hi\n\n', FINISH, FINISH, 'data: [DONE]\n\n']);
    const finishCount = (out.match(/"finish_reason":"stop"/g) || []).length;
    expect(finishCount).toBe(1);
    expect(out.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it('keeps upstream [DONE] and does not send a second one from flush', async () => {
    const out = await pump(['data: hi\n\n', FINISH, 'data: [DONE]\n\n']);
    expect(out.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it('normalizes delta.reasoning into delta.reasoning_content', async () => {
    const out = await pump([
      'data: {"id":"x","choices":[{"index":0,"delta":{"reasoning":"thinking..."}}]}\n\n',
      FINISH,
    ]);
    expect(out).toContain('"reasoning_content":"thinking..."');
    expect(out).not.toContain('"reasoning":');
  });

  it('newline-terminates a trailing buffer frame glued before [DONE]', async () => {
    // No trailing \n on the last frame: flush must add one so the client's
    // parser doesn't read "}data: [DONE]" as one line.
    const out = await pump([
      'data: {"id":"x","choices":[{"index":0,"delta":{"content":"a"}}]}\n\n',
      FINISH,
    ]);
    expect(out.endsWith('data: [DONE]\n\n')).toBe(true);
  });
});
