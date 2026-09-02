import { describe, expect, it } from 'vitest';
import {
  classifyModels,
  isAbortStatus,
  ABORT_STATUSES,
  CLASSIFICATIONS,
} from '@/lib/modelReconcile.js';

const registry = [
  { id: 'llama-3.3-70b', name: 'Llama 3.3 70B' },
  { id: 'qwen-3-32b', name: 'Qwen 3 32B' },
  { id: 'moonshotai/kimi-k2.6', name: 'Kimi K2.6' },
  { id: 'zai-glm-4.7', name: 'GLM 4.7' },
];

const live = [{ id: 'moonshotai/kimi-k2.6' }, { id: 'zai-glm-4.7' }, { id: 'z-ai/glm-5.2' }];

const byId = (result) => Object.fromEntries(result.models.map((m) => [m.id, m.classification]));

const reasonOf = (result, id) => result.models.find((m) => m.id === id)?.reason;

describe('classifyModels — retirement evidence', () => {
  it('classifies a confirmed 410 as retired', () => {
    const result = classifyModels({
      registryModels: registry,
      liveModels: live,
      probes: [{ id: 'zai-glm-4.7', ok: false, status: 410, confirmed: true }],
    });

    expect(byId(result)['zai-glm-4.7']).toBe(CLASSIFICATIONS.RETIRED);
    expect(reasonOf(result, 'zai-glm-4.7')).toBe('gone');
  });

  it('retires a 410 even while the id is still in the live list', () => {
    // 410 Gone is unconditional: NVIDIA kept EOL'd ids listed past their date.
    const result = classifyModels({
      registryModels: registry,
      liveModels: live,
      probes: [{ id: 'moonshotai/kimi-k2.6', ok: false, status: 410, confirmed: true }],
    });

    expect(byId(result)['moonshotai/kimi-k2.6']).toBe(CLASSIFICATIONS.RETIRED);
  });

  it('classifies a confirmed 404 whose id is ABSENT from the live list as retired', () => {
    const result = classifyModels({
      registryModels: registry,
      liveModels: live,
      probes: [{ id: 'llama-3.3-70b', ok: false, status: 404, confirmed: true }],
    });

    expect(byId(result)['llama-3.3-70b']).toBe(CLASSIFICATIONS.RETIRED);
    expect(reasonOf(result, 'llama-3.3-70b')).toBe('absent-and-not-found');
  });

  it('classifies a confirmed 404 whose id IS still in the live list as unreachable-for-account, not retired', () => {
    const result = classifyModels({
      registryModels: registry,
      liveModels: live,
      probes: [{ id: 'moonshotai/kimi-k2.6', ok: false, status: 404, confirmed: true }],
    });

    expect(byId(result)['moonshotai/kimi-k2.6']).toBe(CLASSIFICATIONS.UNREACHABLE);
    expect(byId(result)['moonshotai/kimi-k2.6']).not.toBe(CLASSIFICATIONS.RETIRED);
    expect(reasonOf(result, 'moonshotai/kimi-k2.6')).toBe('not-found-for-account');
  });

  it('never retires on absence from the live list alone', () => {
    const result = classifyModels({ registryModels: registry, liveModels: live, probes: [] });

    expect(byId(result)['llama-3.3-70b']).toBe(CLASSIFICATIONS.UNKNOWN);
    expect(reasonOf(result, 'llama-3.3-70b')).toBe('absent-unprobed');
    expect(result.summary.retired).toBe(0);
  });

  it('does not condemn on a failure that is neither 410 nor 404', () => {
    const result = classifyModels({
      registryModels: registry,
      liveModels: live,
      probes: [
        { id: 'llama-3.3-70b', ok: false, status: 500, confirmed: true },
        { id: 'qwen-3-32b', ok: false, status: null, error: 'timeout', confirmed: true },
      ],
    });

    expect(byId(result)['llama-3.3-70b']).toBe(CLASSIFICATIONS.UNKNOWN);
    expect(byId(result)['qwen-3-32b']).toBe(CLASSIFICATIONS.UNKNOWN);
    expect(reasonOf(result, 'llama-3.3-70b')).toBe('inconclusive-failure');
    expect(result.summary.retired).toBe(0);
  });
});

describe('classifyModels — a single failure is never a verdict', () => {
  it('treats a first failure that succeeds on confirmation as present', () => {
    // The caller re-probes after a pause and reports the settled outcome:
    // the confirmation passed, so the model is alive.
    const result = classifyModels({
      registryModels: registry,
      liveModels: live,
      probes: [{ id: 'llama-3.3-70b', ok: true, status: 200, confirmed: false }],
    });

    expect(byId(result)['llama-3.3-70b']).toBe(CLASSIFICATIONS.PRESENT);
    expect(reasonOf(result, 'llama-3.3-70b')).toBe('probe-ok');
    expect(result.summary.retired).toBe(0);
  });

  it('refuses to condemn an unconfirmed failure, even a 410', () => {
    const result = classifyModels({
      registryModels: registry,
      liveModels: live,
      probes: [
        { id: 'llama-3.3-70b', ok: false, status: 410, confirmed: false },
        { id: 'qwen-3-32b', ok: false, status: 404, confirmed: false },
      ],
    });

    expect(byId(result)['llama-3.3-70b']).toBe(CLASSIFICATIONS.UNKNOWN);
    expect(byId(result)['qwen-3-32b']).toBe(CLASSIFICATIONS.UNKNOWN);
    expect(reasonOf(result, 'llama-3.3-70b')).toBe('unconfirmed-failure');
    expect(result.summary.retired).toBe(0);
  });
});

describe('classifyModels — account-level errors abort the run', () => {
  it('condemns nothing already classified when a 429 aborts mid-run', () => {
    const result = classifyModels({
      registryModels: registry,
      liveModels: live,
      // Both of these would stand as condemnations on a completed run.
      probes: [
        { id: 'llama-3.3-70b', ok: false, status: 404, confirmed: true },
        { id: 'moonshotai/kimi-k2.6', ok: false, status: 410, confirmed: true },
        { id: 'zai-glm-4.7', ok: true, status: 200, confirmed: false },
      ],
      aborted: true,
      abortReason: 'Account-level 429 on qwen-3-32b; the run condemns nothing.',
    });

    expect(result.summary.retired).toBe(0);
    expect(result.summary.unreachableForAccount).toBe(0);
    expect(byId(result)['llama-3.3-70b']).toBe(CLASSIFICATIONS.UNKNOWN);
    expect(byId(result)['moonshotai/kimi-k2.6']).toBe(CLASSIFICATIONS.UNKNOWN);
    expect(reasonOf(result, 'llama-3.3-70b')).toBe('run-aborted');
    // A success is not a condemnation, so it survives the abort.
    expect(byId(result)['zai-glm-4.7']).toBe(CLASSIFICATIONS.PRESENT);
    expect(result.aborted).toBe(true);
    expect(result.abortReason).toMatch(/429/);
  });

  it('never condemns on an account-level status attached to a model', () => {
    for (const status of ABORT_STATUSES) {
      const result = classifyModels({
        registryModels: registry,
        liveModels: live,
        probes: [{ id: 'llama-3.3-70b', ok: false, status, confirmed: true }],
      });

      expect(byId(result)['llama-3.3-70b']).toBe(CLASSIFICATIONS.UNKNOWN);
      expect(reasonOf(result, 'llama-3.3-70b')).toBe('account-level-error');
      expect(result.summary.retired).toBe(0);
    }
  });

  it('recognises 401, 402 and 429 as account-level and 404/410 as not', () => {
    expect(ABORT_STATUSES).toEqual([401, 402, 429]);
    expect(isAbortStatus(429)).toBe(true);
    expect(isAbortStatus('402')).toBe(true);
    expect(isAbortStatus(404)).toBe(false);
    expect(isAbortStatus(410)).toBe(false);
    expect(isAbortStatus(null)).toBe(false);
  });
});

describe('classifyModels — an unusable live list classifies nothing', () => {
  it('condemns nothing when the live list is empty', () => {
    const result = classifyModels({
      registryModels: registry,
      liveModels: [],
      probes: [
        { id: 'llama-3.3-70b', ok: false, status: 404, confirmed: true },
        { id: 'qwen-3-32b', ok: false, status: 410, confirmed: true },
      ],
    });

    expect(result.liveListUsable).toBe(false);
    expect(result.summary.unknown).toBe(registry.length);
    expect(result.summary.retired).toBe(0);
    expect(result.summary.present).toBe(0);
    expect(reasonOf(result, 'llama-3.3-70b')).toBe('live-list-unavailable');
    expect(result.newUpstream).toEqual([]);
  });

  it('condemns nothing when the live list fetch failed', () => {
    const result = classifyModels({
      registryModels: registry,
      liveModels: null,
      probes: [{ id: 'zai-glm-4.7', ok: false, status: 410, confirmed: true }],
    });

    expect(result.liveListUsable).toBe(false);
    expect(result.summary.retired).toBe(0);
    expect(result.summary.unreachableForAccount).toBe(0);
    expect(new Set(result.models.map((m) => m.classification))).toEqual(
      new Set([CLASSIFICATIONS.UNKNOWN])
    );
  });
});

describe('classifyModels — present and the report-only diff', () => {
  it('classifies an unprobed model still in the live list as present', () => {
    const result = classifyModels({ registryModels: registry, liveModels: live, probes: [] });

    expect(byId(result)['moonshotai/kimi-k2.6']).toBe(CLASSIFICATIONS.PRESENT);
    expect(byId(result)['zai-glm-4.7']).toBe(CLASSIFICATIONS.PRESENT);
    expect(reasonOf(result, 'zai-glm-4.7')).toBe('in-live-list');
    expect(result.summary.present).toBe(2);
  });

  it('matches on upstreamModelId when the registry id is namespaced', () => {
    const result = classifyModels({
      registryModels: [{ id: 'nous/hermes-4-70b', upstreamModelId: 'nousresearch/hermes-4-70b' }],
      liveModels: [{ id: 'nousresearch/hermes-4-70b' }],
      probes: [],
    });

    expect(result.models[0].classification).toBe(CLASSIFICATIONS.PRESENT);
    expect(result.newUpstream).toEqual([]);
  });

  it('reports upstream ids missing from the registry without inferring their kind', () => {
    const result = classifyModels({ registryModels: registry, liveModels: live, probes: [] });

    expect(result.newUpstream).toEqual(['z-ai/glm-5.2']);
    expect(result.summary.newUpstream).toBe(1);
  });

  it('accepts bare string ids on both sides', () => {
    const result = classifyModels({
      registryModels: ['a', 'b'],
      liveModels: ['a', 'c'],
      probes: [],
    });

    expect(byId(result)).toEqual({ a: CLASSIFICATIONS.PRESENT, b: CLASSIFICATIONS.UNKNOWN });
    expect(result.newUpstream).toEqual(['c']);
  });

  it('returns an empty report for an empty registry rather than throwing', () => {
    const result = classifyModels();

    expect(result.models).toEqual([]);
    expect(result.liveListUsable).toBe(false);
    expect(result.summary).toMatchObject({ present: 0, retired: 0, unknown: 0 });
  });
});

describe('classifyModels — purity', () => {
  it('does not mutate its inputs', () => {
    const registryIn = [{ id: 'a', name: 'A' }];
    const liveIn = [{ id: 'b' }];
    const probesIn = [{ id: 'a', ok: false, status: 404, confirmed: true }];
    const snapshot = JSON.stringify({ registryIn, liveIn, probesIn });

    classifyModels({ registryModels: registryIn, liveModels: liveIn, probes: probesIn });

    expect(JSON.stringify({ registryIn, liveIn, probesIn })).toBe(snapshot);
  });

  it('is deterministic across repeated calls with the same input', () => {
    const args = { registryModels: registry, liveModels: live, probes: [] };
    expect(classifyModels(args)).toEqual(classifyModels(args));
  });
});
