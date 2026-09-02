import { describe, expect, it } from 'vitest';
import {
  getCapabilitiesForModel,
  DEFAULT_CAPABILITIES,
} from '../../open-sse/providers/capabilities.js';

// #1089 "Show each model's max context length and make combo rotation
// context-aware" splits into two asks. Ask 1, exposing each model's max
// context length, is ALREADY-CORRECT in this fork: getCapabilitiesForModel
// resolves a contextWindow for every provider/model pair (falling back to
// DEFAULT_CAPABILITIES.contextWindow when nothing more specific is declared),
// and it is already surfaced through /api/v1/models/info, the
// /dashboard/model-context page, and useModelCaps. This file pins that ask.
//
// Ask 2, filtering combo/fallback rotation by context compatibility, is
// genuinely unimplemented: open-sse/services/combo.js's reorderByCapabilities
// only reorders by vision/pdf/audioInput/videoInput/search (HARD_CAPS), never
// by contextWindow. Fixing that means editing open-sse/services/combo.js and
// open-sse/services/accountFallback.js, both outside open-sse/providers/** and
// open-sse/config/**, so it belongs to the "routing" lane, not this one. Not
// asserted here because this lane does not own the fix.

describe('#1089 context length is exposed per model', () => {
  it('resolves a positive contextWindow for a model with no explicit override', () => {
    const caps = getCapabilitiesForModel('some-unknown-provider', 'some-unknown-model');
    expect(caps.contextWindow).toBe(DEFAULT_CAPABILITIES.contextWindow);
    expect(caps.contextWindow).toBeGreaterThan(0);
  });

  it('resolves a model-specific contextWindow that overrides the default', () => {
    const caps = getCapabilitiesForModel('anthropic', 'claude-opus-5');
    expect(caps.contextWindow).toBe(1000000);
  });
});
