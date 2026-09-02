import { describe, expect, it } from 'vitest';
import '../translator/registerAll.js';
import { translateRequest } from '../../open-sse/translator/index.js';
import { FORMATS } from '../../open-sse/translator/formats.js';
import { ROLE } from '../../open-sse/translator/schema/index.js';

// convertGeminiContent short-circuits on the tool results it collected, so a
// functionCall or text part sitting in the SAME content as a functionResponse
// was dropped. Gemini emits that shape whenever a turn carries a result and a
// follow-up together, and the model then answered without the dropped half
// (#2394).
const convert = (contents) =>
  translateRequest(
    FORMATS.GEMINI,
    FORMATS.OPENAI,
    'gemini-2.5-pro',
    { contents },
    false,
    null,
    'gemini'
  );

const priorCall = (id, name) => ({
  role: 'model',
  parts: [{ functionCall: { id, name, args: {} } }],
});

describe('gemini to openai keeps parts co-located with a functionResponse (#2394)', () => {
  it('keeps a functionCall that shares a content with a functionResponse', () => {
    const out = convert([
      priorCall('call_b', 'tool_b'),
      {
        role: 'user',
        parts: [
          { functionResponse: { id: 'call_b', name: 'tool_b', response: { result: 'b done' } } },
          { functionCall: { id: 'call_a', name: 'tool_a', args: {} } },
        ],
      },
    ]);

    expect(out.messages.find((m) => m.role === ROLE.TOOL)?.tool_call_id).toBe('call_b');
    const caller = out.messages.find((m) =>
      m.tool_calls?.some((tc) => tc.function.name === 'tool_a')
    );
    expect(caller).toBeDefined();
    expect(caller.role).toBe(ROLE.ASSISTANT);
  });

  it('keeps text co-located with a functionResponse under the original turn role', () => {
    const out = convert([
      priorCall('call_a', 'tool_a'),
      {
        role: 'user',
        parts: [
          { functionResponse: { id: 'call_a', name: 'tool_a', response: { result: 'a done' } } },
          { text: 'also please summarize' },
        ],
      },
    ]);

    expect(out.messages.find((m) => m.role === ROLE.TOOL)).toBeDefined();
    const text = out.messages.find((m) => m.content === 'also please summarize');
    expect(text).toBeDefined();
    expect(text.role).toBe(ROLE.USER);
  });

  it('emits the tool result before the message it was co-located with', () => {
    const out = convert([
      priorCall('call_a', 'tool_a'),
      {
        role: 'user',
        parts: [
          { functionResponse: { id: 'call_a', name: 'tool_a', response: { result: 'a done' } } },
          { text: 'next' },
        ],
      },
    ]);

    const toolIdx = out.messages.findIndex((m) => m.role === ROLE.TOOL);
    const textIdx = out.messages.findIndex((m) => m.content === 'next');
    expect(toolIdx).toBeGreaterThanOrEqual(0);
    expect(textIdx).toBeGreaterThan(toolIdx);
  });

  it('still flattens several parallel functionResponses into one message each', () => {
    const out = convert([
      {
        role: 'model',
        parts: [
          { functionCall: { id: 'c1', name: 'f1', args: {} } },
          { functionCall: { id: 'c2', name: 'f2', args: {} } },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { id: 'c1', name: 'f1', response: { result: 'r1' } } },
          { functionResponse: { id: 'c2', name: 'f2', response: { result: 'r2' } } },
        ],
      },
    ]);

    const tools = out.messages.filter((m) => m.role === ROLE.TOOL);
    expect(tools.map((m) => m.tool_call_id).sort()).toEqual(['c1', 'c2']);
    expect(out.messages.every((m) => m && typeof m === 'object' && !Array.isArray(m))).toBe(true);
  });
});
