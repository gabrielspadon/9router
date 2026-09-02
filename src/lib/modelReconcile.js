// Model-list reconciliation (issues #3398, #2552).
//
// Upstream presence decides EXISTENCE; the static registry stays the source of
// truth for metadata (name, kind, params, serviceKinds, capabilities.js). This
// module is the pure half: no fetch, no db, no clock. The caller does the I/O
// (live list + paced, confirmed probes) and hands the outcomes in here.
//
// Report only. Nothing here disables, deletes, or writes to the registry.

/**
 * Account-level failures. These say nothing about a model — a tripped rate
 * limiter makes every subsequent probe fail, so one of these anywhere aborts
 * the whole provider run and condemns nothing (#3398, design note 4).
 */
export const ABORT_STATUSES = Object.freeze([401, 402, 429]);

export const isAbortStatus = (status) => ABORT_STATUSES.includes(Number(status));

export const CLASSIFICATIONS = Object.freeze({
  PRESENT: 'present',
  RETIRED: 'retired',
  UNREACHABLE: 'unreachable-for-account',
  UNKNOWN: 'unknown',
});

const idOf = (entry) =>
  (typeof entry === 'string' ? entry : entry?.id || entry?.model || entry?.name) || null;

/**
 * Classify each registry model against the live upstream list and the probe
 * outcomes for one connection.
 *
 * @param {object}   input
 * @param {Array}    input.registryModels  static registry entries ({id, name, kind, upstreamModelId?}) or plain ids
 * @param {Array}    input.liveModels      upstream /v1/models entries; empty or null means the list is unusable
 * @param {Array}    input.probes          settled probe outcomes: {id, ok, status, error, confirmed}
 * @param {boolean}  input.aborted         an account-level status ended the run early
 * @param {string}   input.abortReason
 * @returns {{aborted, abortReason, liveListUsable, models, newUpstream, summary}}
 */
export function classifyModels({
  registryModels = [],
  liveModels = null,
  probes = [],
  aborted = false,
  abortReason = null,
} = {}) {
  const liveListUsable = Array.isArray(liveModels) && liveModels.length > 0;
  const liveIds = new Set(liveListUsable ? liveModels.map(idOf).filter(Boolean) : []);

  const probeById = new Map();
  for (const probe of probes || []) {
    const id = idOf(probe);
    if (id) probeById.set(id, probe);
  }

  const registryIds = new Set();
  const models = (registryModels || []).map((entry) => {
    const id = idOf(entry);
    const upstreamId = typeof entry === 'string' ? null : entry?.upstreamModelId || null;
    registryIds.add(id);
    if (upstreamId) registryIds.add(upstreamId);

    const inLive = liveIds.has(id) || (upstreamId ? liveIds.has(upstreamId) : false);
    const probe = probeById.get(id) || (upstreamId ? probeById.get(upstreamId) : undefined);
    const base = {
      id,
      name: (typeof entry === 'string' ? null : entry?.name) || id,
      inLiveList: inLive,
      probeStatus: probe?.status ?? null,
      probeError: probe?.error ?? null,
    };

    // A live list we could not read (fetch failed, or came back empty) is no
    // evidence at all. Classifying off it would condemn the entire catalog.
    if (!liveListUsable) {
      return { ...base, classification: CLASSIFICATIONS.UNKNOWN, reason: 'live-list-unavailable' };
    }

    if (probe && probe.ok === true) {
      return { ...base, classification: CLASSIFICATIONS.PRESENT, reason: 'probe-ok' };
    }

    if (probe && probe.ok === false) {
      // A single failure is never a verdict. Only a failure re-probed after a
      // pause and still failing is allowed to condemn anything.
      if (probe.confirmed !== true) {
        return { ...base, classification: CLASSIFICATIONS.UNKNOWN, reason: 'unconfirmed-failure' };
      }
      const status = Number(probe.status);
      if (isAbortStatus(status)) {
        return { ...base, classification: CLASSIFICATIONS.UNKNOWN, reason: 'account-level-error' };
      }
      if (status === 410) {
        return { ...base, classification: CLASSIFICATIONS.RETIRED, reason: 'gone' };
      }
      if (status === 404) {
        return inLive
          ? // Still advertised upstream, just not reachable with this account's
            // credential. Condemning it globally would break accounts that do
            // have access (#3398, design note 3).
            {
              ...base,
              classification: CLASSIFICATIONS.UNREACHABLE,
              reason: 'not-found-for-account',
            }
          : { ...base, classification: CLASSIFICATIONS.RETIRED, reason: 'absent-and-not-found' };
      }
      // 5xx, timeout, malformed response: a failure, but not one of the two
      // signals that mean retirement.
      return { ...base, classification: CLASSIFICATIONS.UNKNOWN, reason: 'inconclusive-failure' };
    }

    if (inLive) {
      return { ...base, classification: CLASSIFICATIONS.PRESENT, reason: 'in-live-list' };
    }
    // Absent from the live list is a suspicion, not a verdict — retirement
    // needs a 410 or a 404 as well.
    return { ...base, classification: CLASSIFICATIONS.UNKNOWN, reason: 'absent-unprobed' };
  });

  // An aborted run keeps its successes but withdraws every condemnation: the
  // failures that produced them may be the rate limiter talking.
  const settled = aborted
    ? models.map((model) =>
        model.classification === CLASSIFICATIONS.RETIRED ||
        model.classification === CLASSIFICATIONS.UNREACHABLE
          ? { ...model, classification: CLASSIFICATIONS.UNKNOWN, reason: 'run-aborted' }
          : model
      )
    : models;

  // Report-only additions for #2552. Kind is deliberately not inferred — the
  // upstream response rarely marks it and a wrong guess breaks serviceKinds.
  const newUpstream = liveListUsable
    ? liveModels.map(idOf).filter((id) => id && !registryIds.has(id))
    : [];

  const count = (kind) => settled.filter((m) => m.classification === kind).length;

  return {
    aborted: Boolean(aborted),
    abortReason: aborted ? abortReason : null,
    liveListUsable,
    models: settled,
    newUpstream,
    summary: {
      present: count(CLASSIFICATIONS.PRESENT),
      retired: count(CLASSIFICATIONS.RETIRED),
      unreachableForAccount: count(CLASSIFICATIONS.UNREACHABLE),
      unknown: count(CLASSIFICATIONS.UNKNOWN),
      newUpstream: newUpstream.length,
    },
  };
}

export default classifyModels;
