// The dashboard renders one card per connection and fetches every one of them
// at once (Promise.all over visibleConnections in the ProviderLimits page), and
// each fetch is a LIVE call to the provider, often preceded by an OAuth token
// refresh. With thirty accounts that is thirty simultaneous TLS handshakes plus
// thirty token refreshes, and TLS runs on the libuv threadpool, so the cost is
// spread across cores rather than confined to the event loop. Two browser tabs,
// or a refresh while the first round is still in flight, multiply it again.
//
// Nothing upstream of here bounds that fan-out: the route had no cache, no
// in-flight tracking and no concurrency limit, so the amount of work a single
// page load could start was set by how many accounts the user had configured.
// This gate puts a ceiling on it (#3061).

const MAX_CONCURRENT_PROBES = 4;

const inFlight = new Map();
let active = 0;
const waiting = [];

function releaseSlot() {
  active -= 1;
  const next = waiting.shift();
  if (next) {
    active += 1;
    next();
  }
}

function acquireSlot() {
  if (active < MAX_CONCURRENT_PROBES) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

/**
 * Run `probe` under the shared ceiling, collapsing concurrent callers that want
 * the same thing onto one upstream call.
 *
 * The key carries whatever distinguishes the request, `force` included: a user
 * pressing refresh must not be handed the result of a probe that was already
 * running without it.
 *
 * @param {string} key
 * @param {() => Promise<any>} probe
 * @returns {Promise<any>}
 */
export function runUsageProbe(key, probe) {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const run = acquireSlot()
    .then(probe)
    .finally(() => {
      inFlight.delete(key);
      releaseSlot();
    });

  inFlight.set(key, run);
  return run;
}

// Test seam. The counters are module state on purpose — the ceiling is
// per-process, not per-request — so a suite that exercises them needs a reset.
export function __resetUsageProbeGate() {
  inFlight.clear();
  active = 0;
  waiting.length = 0;
}

export { MAX_CONCURRENT_PROBES };
