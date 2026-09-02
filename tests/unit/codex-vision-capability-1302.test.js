import { describe, it, expect } from 'vitest';
import {
  getCapabilitiesForModel,
  getStaticCapabilitiesForModel,
} from '../../open-sse/providers/capabilities.js';

// #1302 / #1201 — an image the user sends never reaches the model.
//
// The router does not refuse an image: stripUnsupportedModalities removes it and
// leaves "[image omitted: model has no vision support]" behind, so the model
// answers that it cannot see pictures and the request still returns 200. Every
// case below is a model whose capability entry resolved vision:false while the
// model itself reads images, which is the state that produces that placeholder.
describe('codex family resolves vision (#1302, #1201)', () => {
  // models.dev — the source capabilities.js names as authoritative — lists
  // "image" in modalities.input for every one of these ids.
  const CODEX_IDS = [
    'gpt-5-codex',
    'gpt-5.1-codex',
    'gpt-5.1-codex-max',
    'gpt-5.1-codex-mini',
    'gpt-5.2-codex',
    'gpt-5.3-codex',
    'gpt-5.3-codex-spark',
  ];

  it.each(CODEX_IDS)('%s reads images on opencode-zen', (model) => {
    expect(getStaticCapabilitiesForModel('opencode-zen', model).vision).toBe(true);
  });

  // The providers the two reports name: OpenCode (#1302), Cursor (#1201),
  // GitHub Copilot (#1302 comment).
  it.each([
    ['opencode-zen', 'gpt-5.2-codex'],
    ['cu', 'gpt-5.2-codex'],
    ['cu', 'gpt-5.3-codex'],
    ['gh', 'gpt-5.2-codex'],
    ['blackbox', 'gpt-5.3-codex'],
  ])('%s/%s reads images', (provider, model) => {
    expect(getCapabilitiesForModel(provider, model).vision).toBe(true);
  });

  it('keeps the rest of the codex row intact', () => {
    const caps = getStaticCapabilitiesForModel('opencode-zen', 'gpt-5.3-codex');
    expect(caps).toMatchObject({
      reasoning: true,
      search: true,
      thinkingFormat: 'openai',
      contextWindow: 400000,
      maxOutput: 128000,
    });
  });

  it('does not hand vision to an image-OUTPUT model by widening gpt-5', () => {
    expect(getStaticCapabilitiesForModel('openai', 'gpt-5-image').imageOutput).toBe(true);
    expect(getStaticCapabilitiesForModel('openai', 'gpt-5-image').vision).toBe(false);
  });
});

// A provider entry REPLACES the pattern capabilities rather than merging over
// them, so a row added for one field silently drops every other. The meta rows
// were added for thinkingFormat and took the input modalities down with them,
// leaving Muse Spark text-only on its own vendor while every other provider
// serving the same ids reads images.
describe('meta provider entry keeps Muse Spark multimodal', () => {
  it.each(['muse-spark-1.2', 'muse-spark-1.2-contributor', 'muse-spark-1.1'])(
    'meta/%s keeps vision, audio and video input',
    (model) => {
      const caps = getStaticCapabilitiesForModel('meta', model);
      expect(caps.vision).toBe(true);
      expect(caps.audioInput).toBe(true);
      expect(caps.videoInput).toBe(true);
      // and still carries the reasoning contract the entry was added for
      expect(caps.thinkingFormat).toBe('meta');
      expect(caps.thinkingCanDisable).toBe(false);
      expect(caps.maxOutput).toBe(64000);
    }
  );
});

// A capability entry is keyed by whatever string reaches lookup, and a combo is
// stored as "alias/model", so the alias reaches it unresolved. Four providers
// registered only the canonical id; every alias-routed lookup fell through.
describe('provider aliases resolve to the same entry as the canonical id', () => {
  it.each([
    ['cx', 'codex', 'gpt-5.6-sol'],
    ['kr', 'kiro', 'gpt-5.6-terra'],
    ['cbcn', 'codebuddy-cn', 'glm-5v-turbo'],
    ['qd', 'qoder', 'kmodel_latest'],
  ])('%s/%s matches %s', (alias, canonical, model) => {
    expect(getStaticCapabilitiesForModel(alias, model)).toEqual(
      getStaticCapabilitiesForModel(canonical, model)
    );
  });

  it('cbcn/glm-5v-turbo reads images (GLM-5V is a vision model)', () => {
    expect(getStaticCapabilitiesForModel('cbcn', 'glm-5v-turbo').vision).toBe(true);
  });

  it('qd/* no longer falls to the 200K text-only floor', () => {
    const caps = getStaticCapabilitiesForModel('qd', 'ultimate');
    expect(caps.vision).toBe(true);
    expect(caps.contextWindow).toBe(1000000);
  });

  it('an unknown provider still falls through to the pattern table', () => {
    expect(getStaticCapabilitiesForModel('some-reseller', 'claude-opus-5').vision).toBe(true);
    expect(getStaticCapabilitiesForModel('some-reseller', 'nothing-at-all').vision).toBe(false);
  });
});
