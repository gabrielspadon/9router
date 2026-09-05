/**
 * TokenProxy AI Memory & Token Optimization Service
 *
 * Modular pipeline integrating:
 * - Phase 1: Tool Output Pruning & Historical Media Pruning
 * - Phase 2: Sliding Window Context Compaction
 * - Phase 4: Cross-Session Handoff Injection
 *
 * SPEND THE WINDOW (2026-09-04). These savers used to run on fixed thresholds
 * that knew nothing about the model they were shaping for: tool pruning on
 * every request regardless of size, and compaction at a flat 32,000 tokens.
 * Against a one-million token window that is not optimization, it is throwing
 * away context the operator paid for — 212 million tokens of it across six
 * hours on the RTX seam — and rewriting the prompt prefix every turn, which
 * invalidates the provider's cache and bills a full re-prime to save history
 * nobody asked to lose.
 *
 * The pipeline is now a LADDER, climbed only as far as the overflow requires:
 *
 *   0. request fits inside the window less its reserve  -> nothing is touched
 *   1. trim the oldest tool results, generously          (almost no loss)
 *   2. replace historical media with placeholders        (already described)
 *   3. trim the oldest tool results, hard                (real loss)
 *   4. summarize the older conversation                  (last resort, opt-in)
 *
 * Each rung re-measures before the next is considered, so the cheapest thing
 * that clears the overflow is the only thing that happens. Prune as little as
 * possible and as much as needed.
 */

import { pruneHistoricalTools, PRESSURE_TIERS } from "./toolPruner.js";
import { pruneHistoricalMedia } from "./mediaPruner.js";
import { compactContextWindow } from "./contextCompactor.js";
import { injectPendingHandoff } from "./handoffStore.js";
import { measureContextPressure, resolveContextBudget } from "./contextBudget.js";

// Rung 1 trims to these caps; rung 3 continues with the tighter ones. Split so
// media, which has already been described in the assistant's own replies, is
// given up before a tool result is cut to a fifth of a page.
const GENTLE_TIERS = PRESSURE_TIERS.slice(0, 3);
const HARD_TIERS = PRESSURE_TIERS.slice(3);

/**
 * Apply all enabled memory enhancements to a request body in sequence
 * @param {Object} body - Request body
 * @param {Object} options
 * @param {Object} [options.settings] - tokenproxy settings object (from localDb)
 * @param {string} [options.targetFormat] - Target provider format
 * @param {number} [options.contextWindow] - the upstream model's own context
 *   window, from getCapabilitiesForModel. Absent falls back to the engine
 *   default, which is deliberately conservative.
 * @param {string} [options.projectKey] - Optional project key for handoffs
 * @param {Object} [options.log] - Logger instance
 * @returns {Promise<{ body: Object, stats: Object }>}
 */
export async function applyMemoryEnhancements(body, options = {}) {
  const {
    settings = {},
    targetFormat = "openai",
    contextWindow = null,
    projectKey,
    log,
  } = options;

  const stats = {
    toolPruning: { applied: false, savedChars: 0, tiersUsed: 0 },
    mediaPruning: { applied: false, savedItems: 0 },
    compaction: { applied: false, savedTokens: 0 },
    handoff: { applied: false },
    budget: null,
  };

  if (!body || typeof body !== "object") {
    return { body, stats };
  }

  // 1. Phase 4: Pending Handoff Injection (if enabled). Additive, and it runs
  // BEFORE the measurement so what it adds is inside the budget rather than
  // smuggled past it.
  if (settings.memoryHandoffEnabled) {
    const handoffRes = injectPendingHandoff(body, {
      enabled: true,
      projectKey,
    });
    if (handoffRes.injected) {
      stats.handoff.applied = true;
      log?.debug?.("MEMORY", `Injected previous session handoff for project: ${projectKey}`);
    }
  }

  const toolPruningEnabled = settings.memoryToolPruningEnabled !== false;
  const mediaPruningEnabled = settings.memoryMediaPruningEnabled !== false;
  const compactionEnabled = settings.memoryCompactionEnabled === true;

  const budget = resolveContextBudget({ contextWindow, settings });
  const measure = () => measureContextPressure(body, { contextWindow, settings });
  let pressure = measure();
  // `projected` and `over` describe the request AS IT ARRIVED, which is the
  // question an operator is asking when they look at this. `projectedAfter` and
  // `overAfter` describe what actually went upstream, and the two differ only
  // when a rung below fired.
  stats.budget = {
    limit: pressure.limit,
    reserve: pressure.reserve,
    budget: pressure.budget,
    projected: pressure.projected,
    over: pressure.over,
    projectedAfter: pressure.projected,
    overAfter: pressure.over,
  };

  // THE WHOLE POINT. Inside the budget, the conversation is left exactly as the
  // client sent it. That is what lets a session actually reach the window it
  // is paying for, and it is what keeps the prompt prefix byte-identical from
  // one turn to the next so the provider's cache keeps hitting.
  if (!pressure.over) {
    log?.debug?.(
      "MEMORY",
      `within budget: ~${pressure.projected} of ${pressure.budget} tokens`
      + ` (window ${pressure.limit}, reserve ${pressure.reserve}) — nothing pruned`,
    );
    return { body, stats };
  }

  log?.info?.(
    "MEMORY",
    `over budget: ~${pressure.projected} tokens against ${pressure.budget}`
    + ` (window ${pressure.limit}) — reclaiming ~${pressure.deficitTokens}`,
  );

  // An operator who configured a hard floor still gets it, as the tightest tier
  // rather than as the everyday cap it used to be. Silently ignoring a setting
  // someone deliberately set is worse than honoring it late.
  const configuredFloor = Number(settings.memoryMaxHistoricalToolChars);
  const floorTier = Number.isFinite(configuredFloor) && configuredFloor > 0
    ? [Math.floor(configuredFloor)]
    : [];

  const runTools = (tiers) => {
    if (!toolPruningEnabled || !pressure.over) return;
    const res = pruneHistoricalTools(body, {
      enabled: true,
      budgetAware: true,
      deficitChars: pressure.deficitChars,
      keepRecentTurns: settings.memoryMaxToolTurnsKeepFull,
      tiers,
    });
    if (res.pruned) {
      stats.toolPruning.applied = true;
      stats.toolPruning.savedChars += res.savedChars;
      stats.toolPruning.tiersUsed += res.tiersUsed;
      log?.info?.(
        "MEMORY",
        `tool prune tier${tiers[0]}: ~${Math.round(res.savedChars / 4)} tokens`
        + ` across ${res.count} historical tool turns`,
      );
      pressure = measure();
    }
  };

  // Rung 1: generous caps. A 20,000-character cap on a build log loses the
  // middle of one file dump and nothing a model was reasoning about.
  runTools(GENTLE_TIERS);

  // Rung 2: historical media. The assistant has already described these in its
  // own replies, which stay in the conversation, so the placeholder keeps the
  // thread of what happened while giving back the payload.
  if (mediaPruningEnabled && (pressure.over || settings.memoryMediaPruningAlways === true)) {
    const mediaRes = pruneHistoricalMedia(body, { enabled: true });
    if (mediaRes.pruned) {
      stats.mediaPruning = { applied: true, savedItems: mediaRes.savedItems };
      log?.debug?.("MEMORY", `Pruned ${mediaRes.savedItems} historical media items`);
      pressure = measure();
    }
  }

  // Rung 3: hard caps, then any floor the operator configured. This is where
  // information is genuinely lost, so it is reached only when rungs 1 and 2
  // did not clear the overflow.
  runTools([...HARD_TIERS, ...floorTier]);

  // Rung 4: Phase 2 sliding-window compaction. Still opt-in, and now the LAST
  // resort rather than a flat 32,000-token trigger — which on a one-million
  // token window fired at 3% of capacity. Its threshold is the budget, so
  // enabling it can no longer cost a conversation that fits.
  if (compactionEnabled && pressure.over) {
    const compactRes = compactContextWindow(body, {
      enabled: true,
      thresholdTokens: settings.memoryCompactionThresholdTokens ?? budget.budget,
      recentTurnsToKeep: settings.memoryRecentTurnsToKeep ?? 8,
    });
    if (compactRes.compacted) {
      // `savedTokens` is not a field the compactor returns; reading it gave
      // `undefined`, which is what the pipeline line printed.
      const saved = Math.max(0, (compactRes.originalTokens || 0) - (compactRes.newTokens || 0));
      stats.compaction = { applied: true, savedTokens: saved };
      log?.info?.(
        "MEMORY",
        `Context Compactor reduced prompt from ~${compactRes.originalTokens}`
        + ` to ~${compactRes.newTokens} tokens`,
      );
      pressure = measure();
    }
  }

  stats.budget.projectedAfter = pressure.projected;
  stats.budget.overAfter = pressure.over;
  if (pressure.over) {
    // Said out loud rather than silently cutting into the protected recent
    // turns: at this point the CURRENT turn alone does not fit, and the right
    // answer is the upstream's own context error, not a request we quietly
    // mangled into shape.
    log?.warn?.(
      "MEMORY",
      `still ~${pressure.projected} tokens against ${pressure.budget} after every rung`
      + ` — the current turn does not fit and is being sent as-is`,
    );
  }

  return { body, stats };
}

export * from "./toolPruner.js";
export * from "./mediaPruner.js";
export * from "./contextCompactor.js";
export * from "./handoffStore.js";
export * from "./contextBudget.js";
