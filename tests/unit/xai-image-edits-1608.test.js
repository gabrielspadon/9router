import { describe, expect, it } from 'vitest';
import { PROVIDER_MEDIA } from '../../open-sse/providers/index.js';
import REGISTRY from '../../open-sse/providers/registry/index.js';

// #1608 "Add image-to-image edits support for Grok image models": xAI's own
// REST reference (docs.x.ai/developers/model-capabilities/images/editing,
// checked 2026-08-31) documents POST /v1/images/edits as a JSON body
// ({model, prompt, image:{url|data-uri, type:"image_url"}}), explicitly
// incompatible with the OpenAI SDK's multipart images.edit(). That same
// reference lists only "grok-imagine-image-2.0" as edit-capable — the other
// three xai image models (grok-2-image-1212, grok-imagine-image,
// grok-imagine-image-quality) are documented generations-only. This fork has
// no /v1/images/edits route or per-provider edit handler yet (none of the 40+
// providers do), so this test pins the registry-side contract only: the
// prerequisite a future handlers+route change would consume, mirroring how
// imageConfig/videoConfig are declared and wired into PROVIDER_MEDIA today.
const xai = () => REGISTRY.find((r) => r.id === 'xai');

describe('#1608 xai image-edits registry contract', () => {
  it('declares imageEditConfig for the xAI JSON edits endpoint', () => {
    expect(PROVIDER_MEDIA.xai?.imageEditConfig).toEqual({
      baseUrl: 'https://api.x.ai/v1/images/edits',
      bodyFields: ['model', 'prompt', 'image'],
      models: ['grok-imagine-image-2.0'],
    });
  });

  it("scopes edit support to grok-imagine-image-2.0 only, per xAI's own docs", () => {
    const editModels = PROVIDER_MEDIA.xai.imageEditConfig.models;
    expect(editModels).not.toContain('grok-imagine-image');
    expect(editModels).not.toContain('grok-imagine-image-quality');
    expect(editModels).not.toContain('grok-2-image-1212');
  });

  it("every declared edit model is a real image model in xai's own catalog", () => {
    const imageModelIds = new Set(
      xai()
        .models.filter((m) => m.kind === 'image')
        .map((m) => m.id)
    );
    for (const id of PROVIDER_MEDIA.xai.imageEditConfig.models) {
      expect(imageModelIds.has(id)).toBe(true);
    }
  });
});
