// #1173: opencode's own gateway returns a raw Claude-shaped body on
// /v1/chat/completions when hit with stream:false for some models
// (observed: qwen3.6-plus, qwen3.6-plus-free — the latter 500s outright on
// stream:false). stream:true against the same endpoint is reported working.
// forceStream routes every request (including JSON clients) through the
// streaming code path, which already turns provider SSE back into JSON via
// parseSSEToOpenAIResponse — sidestepping opencode's broken non-stream branch
// entirely instead of trying to re-detect the response shape after the fact.
import { describe, expect, it } from 'vitest';
import { PROVIDERS } from '../../open-sse/config/providers.js';

describe('opencode forceStream (#1173)', () => {
  it("forces streaming so JSON clients never hit opencode's broken stream:false branch", () => {
    expect(PROVIDERS.opencode.forceStream).toBe(true);
  });
});
