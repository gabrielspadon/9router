import { describe, it, expect } from 'vitest';
import { geminiToOpenAIResponse } from 'open-sse/translator/response/gemini-to-openai.js';
import { formatSSE, parseSSELine } from 'open-sse/utils/streamHelpers.js';
import { FORMATS } from 'open-sse/translator/formats.js';

// #2273 — "malformed SSE stream for gc/ models". The report blames a spawned
// CLI's terminal output, but gemini-cli is an ordinary HTTP transport here.
// Both halves of the observable complaint are already handled: control bytes
// are stripped on the gemini-cli path, and every emitted frame is terminated.
const geminiChunk = (text) => ({
  responseId: 'r1',
  modelVersion: 'gemini-2.5-pro',
  candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
});

const textDeltas = (chunks) =>
  chunks.map((c) => c.choices?.[0]?.delta?.content).filter((v) => typeof v === 'string');

describe('gemini-cli SSE framing (#2273)', () => {
  it('strips ANSI and C0/C1 controls out of gc/ text', () => {
    const dirty = '\x1b[2Kload\x1b[38;5;1ming\x07 done\x9b0m';
    const out = geminiToOpenAIResponse(geminiChunk(dirty), { provider: 'gemini-cli' });
    const content = textDeltas(out).join('');
    expect(content).toBe('loading done');
    expect(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(content)).toBe(false);
  });

  it('leaves generic gemini text byte-preserved', () => {
    const raw = 'keep\x1b[31m me';
    const out = geminiToOpenAIResponse(geminiChunk(raw), { provider: 'gemini' });
    expect(textDeltas(out).join('')).toBe(raw);
  });

  it('keeps ordinary whitespace, which SSE JSON-escapes anyway', () => {
    const out = geminiToOpenAIResponse(geminiChunk('a\nb\tc'), { provider: 'gemini-cli' });
    const frame = formatSSE(
      out.find((c) => c.choices?.[0]?.delta?.content),
      FORMATS.GEMINI_CLI
    );
    expect(JSON.parse(frame.slice(6, -2)).choices[0].delta.content).toBe('a\nb\tc');
    // The raw newline never reaches the wire, so it cannot split the frame.
    expect(frame.slice(0, -2)).not.toContain('\n');
  });

  it('terminates every emitted frame with a blank line', () => {
    const out = geminiToOpenAIResponse(geminiChunk('hi'), { provider: 'gemini-cli' });
    expect(out.length).toBeGreaterThan(0);
    for (const chunk of out) {
      const frame = formatSSE(chunk, FORMATS.GEMINI_CLI);
      expect(frame.startsWith('data: ')).toBe(true);
      expect(frame.endsWith('\n\n')).toBe(true);
    }
    expect(formatSSE({ done: true }, FORMATS.GEMINI_CLI)).toBe('data: [DONE]\n\n');
  });

  it('parses a gc/ data line that carries wire control bytes', () => {
    const line = `data: \x1b[2K{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}`;
    expect(parseSSELine(line, FORMATS.GEMINI_CLI)).toEqual({
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
    });
    // Generic gemini keeps the strict parse rather than sanitizing every stream.
    expect(parseSSELine(line, FORMATS.GEMINI)).toBeNull();
  });
});
