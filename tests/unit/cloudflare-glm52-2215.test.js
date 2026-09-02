import { describe, expect, it } from 'vitest';
import CF from 'open-sse/providers/registry/cloudflare-ai.js';
import { isValidModel, getModelUpstreamId } from 'open-sse/config/providerModels.js';
import { getCapabilitiesForModel } from 'open-sse/providers/capabilities.js';
import { getThinkingLevels } from 'open-sse/providers/thinkingLevels.js';
import { getPricingForModel } from 'open-sse/providers/pricing.js';

const MODEL = '@cf/zai-org/glm-5.2';
// Its sibling, already in the catalog and working. Everything below is asserted
// at parity with it, which is what makes "no capability or pricing entry needed"
// a measurement rather than a claim.
const SIBLING = '@cf/zai-org/glm-4.7-flash';

describe('Cloudflare Workers AI offers GLM 5.2 (#2215)', () => {
  it('is in the catalog and accepted as a model id', () => {
    expect(CF.models.map((m) => m.id)).toContain(MODEL);
    expect(isValidModel('cloudflare-ai', MODEL)).toBe(true);
  });

  it('goes upstream under its own id', () => {
    expect(getModelUpstreamId('cloudflare-ai', MODEL)).toBe(MODEL);
  });

  it('resolves the same capabilities as its already-working sibling', () => {
    const caps = getCapabilitiesForModel('cloudflare-ai', MODEL);
    const sibling = getCapabilitiesForModel('cloudflare-ai', SIBLING);
    // Parity holds on everything the sibling establishes, which is what makes
    // "no bespoke entry needed" a measurement. The one deliberate divergence
    // is the reasoning-effort level, which GLM reads from 5.2 onward and the
    // 4.7 sibling does not, so asserting it separately keeps the parity claim
    // honest instead of quietly widening it.
    const { thinkingEffortSupported: _mine, ...rest } = caps;
    const { thinkingEffortSupported: _theirs, ...siblingRest } = sibling;
    expect(rest).toEqual(siblingRest);
    expect(caps.thinkingEffortSupported).toBe(true);
    expect(sibling.thinkingEffortSupported).toBe(false);
    expect(caps.reasoning).toBe(true);
    expect(caps.tools).toBe(true);
  });

  it("inherits the gateway's thinking ladder, which excludes xhigh", () => {
    const levels = getThinkingLevels('cloudflare-ai', MODEL);
    expect(levels).toEqual(getThinkingLevels('cloudflare-ai', SIBLING));
    expect(levels).not.toContain('xhigh');
  });

  it('needs no pricing row — its sibling has none either', () => {
    expect(getPricingForModel(MODEL, 'cloudflare-ai')).toBe(
      getPricingForModel(SIBLING, 'cloudflare-ai')
    );
  });
});
