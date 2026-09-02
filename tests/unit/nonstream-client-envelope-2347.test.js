/**
 * #2347 — a non-OpenAI client must not receive the OpenAI chat.completion
 * envelope from the non-streaming path, and its function calls must survive.
 *
 * fromOpenAICompletion only knew `openai-responses` and `claude`; every other
 * client (gemini, gemini-cli, vertex, antigravity, ollama) got `choices[]`
 * back, so its tool calls sat in `choices[0].message.tool_calls`, a field none
 * of them reads.
 */
import { describe, it, expect } from 'vitest';
import {
  translateNonStreamingResponse,
  hasUsefulContent,
} from 'open-sse/handlers/chatCore/nonStreamingHandler.js';
import { FORMATS } from 'open-sse/translator/formats.js';
import { ollamaBodyToOpenAI } from 'open-sse/translator/response/ollama-to-openai.js';

const OPENAI_BODY = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1700000000,
  model: 'm',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: 'answer',
        reasoning_content: 'think',
        // OpenAI carries tool arguments as a JSON STRING.
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } },
          { id: 'call_2', type: 'function', function: { name: 'write', arguments: '{"p":"/a"}' } },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
  usage: {
    prompt_tokens: 3,
    completion_tokens: 5,
    total_tokens: 8,
    completion_tokens_details: { reasoning_tokens: 2 },
  },
};

const GEMINI_FAMILY = [FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX, FORMATS.ANTIGRAVITY];

describe.each(GEMINI_FAMILY)('openai provider -> %s client, non-streaming', (clientFormat) => {
  const out = translateNonStreamingResponse(OPENAI_BODY, FORMATS.OPENAI, clientFormat);

  it('hands back a Gemini candidates envelope, never choices[]', () => {
    expect(out.choices).toBeUndefined();
    expect(out.object).not.toBe('chat.completion');
    expect(Array.isArray(out.response.candidates)).toBe(true);
  });

  it('keeps reasoning, visible text and both function calls', () => {
    const parts = out.response.candidates[0].content.parts;
    expect(parts[0]).toEqual({ thought: true, text: 'think' });
    expect(parts[1]).toEqual({ text: 'answer' });
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
    expect(calls.map((c) => c.name)).toEqual(['lookup', 'write']);
  });

  it('delivers tool arguments as an OBJECT, not the OpenAI JSON string', () => {
    const call = out.response.candidates[0].content.parts.find((p) => p.functionCall).functionCall;
    expect(call.args).toEqual({ q: 'x' });
    expect(typeof call.args).toBe('object');
  });

  it('carries the finish reason and usage across', () => {
    expect(out.response.candidates[0].finishReason).toBe('STOP');
    expect(out.response.usageMetadata).toMatchObject({
      promptTokenCount: 3,
      candidatesTokenCount: 5,
      totalTokenCount: 8,
      thoughtsTokenCount: 2,
    });
  });

  it('round-trips back to the same OpenAI body', () => {
    const back = translateNonStreamingResponse(out, clientFormat, FORMATS.OPENAI);
    const msg = back.choices[0].message;
    expect(msg.content).toBe('answer');
    expect(msg.reasoning_content).toBe('think');
    expect(back.choices[0].finish_reason).toBe('tool_calls');
    expect(msg.tool_calls.map((t) => t.function.name)).toEqual(['lookup', 'write']);
    // Back on the OpenAI side arguments must be a JSON string again.
    expect(msg.tool_calls[0].function.arguments).toBe('{"q":"x"}');
    expect(back.usage.total_tokens).toBe(8);
  });
});

describe('openai provider -> ollama client, non-streaming', () => {
  const out = translateNonStreamingResponse(OPENAI_BODY, FORMATS.OPENAI, FORMATS.OLLAMA);

  it('hands back an Ollama envelope, never choices[]', () => {
    expect(out.choices).toBeUndefined();
    expect(out.done).toBe(true);
    expect(out.message.role).toBe('assistant');
  });

  it('keeps text, thinking and both tool calls with OBJECT arguments', () => {
    expect(out.message.content).toBe('answer');
    expect(out.message.thinking).toBe('think');
    expect(out.message.tool_calls.map((t) => t.function.name)).toEqual(['lookup', 'write']);
    expect(out.message.tool_calls[0].function.arguments).toEqual({ q: 'x' });
  });

  it("reports usage in Ollama's own token fields", () => {
    expect(out.prompt_eval_count).toBe(3);
    expect(out.eval_count).toBe(5);
    // Ollama has no tool_calls done_reason on the wire.
    expect(out.done_reason).toBe('stop');
  });

  it('round-trips back through ollamaBodyToOpenAI', () => {
    const back = ollamaBodyToOpenAI(out);
    const msg = back.choices[0].message;
    expect(msg.content).toBe('answer');
    expect(msg.reasoning_content).toBe('think');
    expect(back.choices[0].finish_reason).toBe('tool_calls');
    expect(msg.tool_calls[0].function.arguments).toBe('{"q":"x"}');
    expect(back.usage.prompt_tokens).toBe(3);
  });

  it('accepts arguments already given as an object', () => {
    const objArgs = {
      ...OPENAI_BODY,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            tool_calls: [
              { id: 'c', type: 'function', function: { name: 'f', arguments: { a: 1 } } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };
    const o = translateNonStreamingResponse(objArgs, FORMATS.OPENAI, FORMATS.OLLAMA);
    expect(o.message.tool_calls[0].function.arguments).toEqual({ a: 1 });
  });
});

describe('a Responses-shaped provider reaching a gemini or ollama client (:305-312 fall-through)', () => {
  const RESPONSES_BODY = {
    id: 'resp_1',
    object: 'response',
    model: 'm',
    output: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] },
      { type: 'function_call', call_id: 'call_9', name: 'lookup', arguments: '{"q":"y"}' },
    ],
    usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
  };

  it('projects to the Gemini envelope instead of falling through unchanged', () => {
    const out = translateNonStreamingResponse(
      RESPONSES_BODY,
      FORMATS.OPENAI_RESPONSES,
      FORMATS.GEMINI
    );
    expect(out.output).toBeUndefined();
    expect(out.choices).toBeUndefined();
    const parts = out.response.candidates[0].content.parts;
    expect(parts.find((p) => p.text)?.text).toBe('hi');
    expect(parts.find((p) => p.functionCall).functionCall).toEqual({
      name: 'lookup',
      args: { q: 'y' },
    });
  });

  it('projects to the Ollama envelope instead of falling through unchanged', () => {
    const out = translateNonStreamingResponse(
      RESPONSES_BODY,
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OLLAMA
    );
    expect(out.output).toBeUndefined();
    expect(out.choices).toBeUndefined();
    expect(out.message.content).toBe('hi');
    expect(out.message.tool_calls[0].function.arguments).toEqual({ q: 'y' });
  });
});

describe('a gemini provider reaching a claude or ollama client', () => {
  const GEMINI_BODY = {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: 'hi' }, { functionCall: { name: 'lookup', args: { q: 'z' } } }],
        },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 },
  };

  it('gives a Claude client content blocks, not choices[]', () => {
    const out = translateNonStreamingResponse(GEMINI_BODY, FORMATS.GEMINI, FORMATS.CLAUDE);
    expect(out.choices).toBeUndefined();
    expect(out.content.find((b) => b.type === 'tool_use').input).toEqual({ q: 'z' });
  });

  it('gives an Ollama client an Ollama envelope, not choices[]', () => {
    const out = translateNonStreamingResponse(GEMINI_BODY, FORMATS.GEMINI, FORMATS.OLLAMA);
    expect(out.choices).toBeUndefined();
    expect(out.message.tool_calls[0].function.arguments).toEqual({ q: 'z' });
  });
});

describe('hasUsefulContent judges the non-OpenAI envelopes it now sees', () => {
  const wrap = (parts) => ({ response: { candidates: [{ content: { parts } }] } });

  it('accepts a Gemini envelope carrying only a function call', () => {
    expect(hasUsefulContent(wrap([{ functionCall: { name: 'f', args: {} } }]), false, false)).toBe(
      true
    );
  });

  it('accepts a bare (unwrapped) Gemini envelope', () => {
    expect(
      hasUsefulContent({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }, false, false)
    ).toBe(true);
  });

  it('still rejects an empty Gemini envelope so the fallback loop fires (#2727)', () => {
    expect(hasUsefulContent(wrap([{ text: '' }]), false, false)).toBe(false);
  });

  it('accepts an Ollama envelope with tool calls and rejects an empty one', () => {
    expect(
      hasUsefulContent(
        { message: { role: 'assistant', content: '', tool_calls: [{}] } },
        false,
        false
      )
    ).toBe(true);
    expect(hasUsefulContent({ message: { role: 'assistant', content: '' } }, false, false)).toBe(
      false
    );
  });

  it('still rejects an unrecognized body', () => {
    expect(hasUsefulContent({}, false, false)).toBe(false);
  });
});
