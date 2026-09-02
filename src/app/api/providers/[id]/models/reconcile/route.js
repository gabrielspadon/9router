import { NextResponse } from 'next/server';
import { getProviderConnectionById } from '@/lib/db/index.js';
import { getProviderModels, PROVIDER_ID_TO_ALIAS } from 'open-sse/config/providerModels.js';
import { UPDATER_CONFIG } from '@/shared/constants/config';
import { pingModelByKind } from '@/app/api/models/test/ping';
import { classifyModels, isAbortStatus } from '@/lib/modelReconcile';
import { GET as fetchLiveModels } from '../route.js';

// Paced, not bursted. #3398 measured a known-good model start returning 429
// after ~8 rapid probes, after which every later probe is noise.
const PROBE_GAP_MS = 1500;
// A failure is re-probed only after the burst window has passed, so a transient
// limiter hit gets a chance to clear before anything is condemned.
const CONFIRM_DELAY_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const loopbackBase = (request) => {
  let port = '';
  try {
    port = new URL(request.url).port;
  } catch {
    /* fall through to env */
  }
  return `http://127.0.0.1:${port || process.env.PORT || UPDATER_CONFIG.appPort}`;
};

/**
 * POST /api/providers/[id]/models/reconcile
 *
 * Reconciles one CONNECTION's static registry model list against that
 * connection's live upstream /v1/models list, probing only what the live list
 * cannot settle. Report only — nothing is disabled, deleted, or written back.
 *
 * ?probe=missing (default) probes just the ids absent from the live list.
 * ?probe=all     also probes ids the live list still advertises, which is the
 *                only way to see "in the catalog, 404 for this account".
 * ?probe=none    classifies from the live list alone, zero upstream load.
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

    const providerId = connection.provider;
    const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
    const registryModels = getProviderModels(alias);

    let probeMode = 'missing';
    try {
      const requested = new URL(request.url).searchParams.get('probe');
      if (requested === 'all' || requested === 'none') probeMode = requested;
    } catch {
      /* keep default */
    }

    // Reuse the existing per-connection live-list fetch rather than restating
    // its provider table. It already handles OAuth refresh, the custom
    // resolvers, and the OpenAI/Anthropic-compatible base-URL shapes.
    let liveModels = null;
    let liveListError = null;
    try {
      const liveResponse = await fetchLiveModels(request, { params });
      const payload = await liveResponse.json();
      if (liveResponse.ok && Array.isArray(payload?.models)) liveModels = payload.models;
      else liveListError = payload?.error || `Live model list failed (HTTP ${liveResponse.status})`;
    } catch (error) {
      liveListError = `Live model list failed: ${error.message}`;
    }

    const liveIds = new Set(
      (liveModels || [])
        .map((m) => (typeof m === 'string' ? m : m?.id || m?.model || m?.name))
        .filter(Boolean)
    );

    const probes = [];
    let aborted = false;
    let abortReason = null;

    // With no usable live list nothing is classifiable, so probing would only
    // spend the connection's rate-limit budget on a run that condemns nothing.
    const probeTargets =
      !liveModels?.length || probeMode === 'none'
        ? []
        : probeMode === 'all'
          ? registryModels
          : registryModels.filter((m) => !liveIds.has(m.id) && !liveIds.has(m.upstreamModelId));

    const baseUrl = loopbackBase(request);
    // ponytail: the probe goes through the loopback gateway, which may satisfy
    // it from a sibling connection of the same provider. That can only soften a
    // verdict (a reachable sibling reads as "present"), never invent a
    // retirement. Pinning it would need a connection header on
    // src/sse/handlers/chat.js, which is outside this file set.
    for (const model of probeTargets) {
      const kind = model.kind || model.type || 'llm';
      const target = `${alias}/${model.id}`;

      let outcome;
      try {
        outcome = await pingModelByKind(target, kind, baseUrl);
      } catch (error) {
        outcome = { ok: false, status: null, error: error.message };
      }

      if (outcome.ok) {
        probes.push({
          id: model.id,
          ok: true,
          status: outcome.status ?? 200,
          error: null,
          confirmed: false,
        });
        await sleep(PROBE_GAP_MS);
        continue;
      }

      if (isAbortStatus(outcome.status)) {
        aborted = true;
        abortReason = `Account-level ${outcome.status} on ${model.id}; the run condemns nothing.`;
        break;
      }

      // Confirm before classifying. A first failure that clears on the second
      // attempt was the limiter, not the model.
      await sleep(CONFIRM_DELAY_MS);
      let confirm;
      try {
        confirm = await pingModelByKind(target, kind, baseUrl);
      } catch (error) {
        confirm = { ok: false, status: null, error: error.message };
      }

      if (isAbortStatus(confirm.status)) {
        aborted = true;
        abortReason = `Account-level ${confirm.status} on ${model.id}; the run condemns nothing.`;
        break;
      }

      probes.push({
        id: model.id,
        ok: confirm.ok === true,
        status: confirm.ok ? (confirm.status ?? 200) : (confirm.status ?? outcome.status ?? null),
        error: confirm.ok ? null : confirm.error || outcome.error || null,
        confirmed: confirm.ok !== true,
      });
      await sleep(PROBE_GAP_MS);
    }

    const result = classifyModels({ registryModels, liveModels, probes, aborted, abortReason });

    return NextResponse.json({
      provider: providerId,
      connectionId: connection.id,
      probeMode,
      probed: probes.length,
      applied: false,
      ...(liveListError ? { liveListError } : {}),
      ...result,
    });
  } catch (error) {
    console.log('Error reconciling provider models:', error);
    return NextResponse.json({ error: 'Reconcile failed' }, { status: 500 });
  }
}
