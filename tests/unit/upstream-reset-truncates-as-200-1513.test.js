/**
 * #1513 — "HTTP 200 proxy error, all models are slow in v63, please revert to
 * v59."
 *
 * The revert is not the answer and the version pair is long gone; this tree is
 * ~90 releases past v0.4.63. What survived from that window is the one hot-path
 * behaviour change in it: createDisconnectAwareStream started treating an
 * upstream transport reset as a graceful close, alongside a caller abort.
 *
 * Bundling those two is what produces the reported pair of symptoms at once. A
 * flaky proxy in front of the upstream resets the socket mid-answer; the client
 * stream closed cleanly, so a truncated answer arrived as a complete HTTP 200
 * with no error in it anywhere. A client cannot distinguish that from a short
 * reply, so it accepts it or retries the whole turn — every model appears slow
 * and the failure appears as a 200.
 *
 * Formats with an exact terminal predicate (openai, claude, openai-responses)
 * grew a terminal observer since, which catches this first. Everything else —
 * the gemini and ollama client formats among them — has no observer, falls
 * through to this branch, and was still silently truncating.
 */

import { describe, expect, it } from 'vitest';
import { createDisconnectAwareStream } from '../../open-sse/utils/streamHandler.js';
import { createSseTerminalObserver } from '../../open-sse/utils/streamTerminal.js';
import { FORMATS } from '../../open-sse/translator/formats.js';

const encoder = new TextEncoder();

// A transform whose readable hands over one chunk of a real answer and then
// dies the way a reset socket dies.
function halfAnswerThen(error) {
  let delivered = false;
  return {
    readable: new ReadableStream({
      pull(controller) {
        if (!delivered) {
          delivered = true;
          controller.enqueue(encoder.encode('data: {"text":"half an ans"}\n\n'));
          return;
        }
        throw error;
      },
    }),
    writable: new WritableStream(),
  };
}

function trackingController() {
  let connected = true;
  const events = [];
  return {
    events,
    controller: {
      signal: new AbortController().signal,
      startTime: Date.now(),
      isConnected: () => connected,
      handleComplete: () => {
        connected = false;
        events.push('complete');
      },
      handleError: (error) => {
        connected = false;
        events.push(['error', error.message]);
      },
      handleDisconnect: (reason) => {
        connected = false;
        events.push(['disconnect', reason]);
      },
      abort: () => {
        connected = false;
      },
    },
  };
}

// Drain to the end, reporting whether the stream finished or broke.
async function drain(stream) {
  const reader = stream.getReader();
  const chunks = [];
  for (;;) {
    try {
      const { done, value } = await reader.read();
      if (done) return { ended: 'closed', text: chunks.join('') };
      chunks.push(new TextDecoder().decode(value));
    } catch (error) {
      return { ended: 'errored', text: chunks.join(''), error };
    }
  }
}

const reset = () =>
  Object.assign(new Error('terminated'), {
    code: 'UND_ERR_SOCKET',
    cause: { code: 'ECONNRESET' },
  });

describe('#1513 an upstream reset must not read as a finished answer', () => {
  it('errors the client stream when the upstream socket dies mid-answer', async () => {
    const { controller, events } = trackingController();
    const out = createDisconnectAwareStream(halfAnswerThen(reset()), controller);

    const result = await drain(out);

    // The partial answer still reaches the client — nothing is thrown away.
    expect(result.text).toContain('half an ans');
    // ...but the stream does not pretend it finished.
    expect(result.ended).toBe('errored');
    expect(events[0][0]).toBe('error');
  });

  it('does the same for the other socket codes a proxy produces', async () => {
    for (const error of [
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
      Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }),
      Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }),
    ]) {
      const { controller } = trackingController();
      const result = await drain(createDisconnectAwareStream(halfAnswerThen(error), controller));
      expect(result.ended, error.code).toBe('errored');
    }
  });

  it('still closes cleanly when the caller is the one who walked away', async () => {
    const { controller } = trackingController();
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });

    const result = await drain(createDisconnectAwareStream(halfAnswerThen(abort), controller));

    expect(result.ended).toBe('closed');
    expect(result.text).toContain('half an ans');
  });

  it('leaves the observed formats to the terminal observer, which already errors them', async () => {
    const { controller } = trackingController();
    const out = createDisconnectAwareStream(halfAnswerThen(reset()), controller, null, {
      terminalObserver: createSseTerminalObserver(FORMATS.OPENAI),
    });

    const result = await drain(out);

    // That path closes the stream, but only after writing an explicit terminal
    // saying the answer is incomplete — so the client is told either way.
    expect(result.ended).toBe('closed');
    expect(result.text).toContain('stream_incomplete');
    expect(result.text).toContain('[DONE]');
  });
});
