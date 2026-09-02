import { NextResponse } from "next/server";
import { buildModelsList } from "@/app/api/v1/models/route.js";
import { GET as getAvailability } from "@/app/api/models/availability/route.js";
import { PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { classifyModel, splitModelId } from "@/shared/services/modelTiers.js";

export const dynamic = "force-dynamic";

/**
 * Suggest a fallback chain, and the tiers it was built from (#1033, #1091).
 *
 * Building a combo by hand means reading a flat list of everything connected and
 * knowing which entries are the expensive ones, which is what both reports are
 * asking to be spared. The models come from the same listing /v1/models serves
 * and the tiering from the shared classifier the auto router also uses; this
 * only orders them.
 */

// Re-exported because the tests and the dashboard already import them from here.
export { classifyModel, splitModelId };

// Blocked set, in the two shapes availability reports and both id spellings.
function buildBlocked(unavailable) {
  const models = new Set();
  const providers = new Set();
  for (const entry of unavailable || []) {
    if (!entry?.provider) continue;
    const alias = PROVIDER_ID_TO_ALIAS[entry.provider] || entry.provider;
    if (!entry.model || entry.model === "__all") {
      providers.add(alias);
      providers.add(entry.provider);
      continue;
    }
    models.add(`${alias}/${entry.model}`);
    models.add(`${entry.provider}/${entry.model}`);
  }
  return { models, providers };
}

/**
 * Order a chain: capable first, then cheap.
 *
 * A fallback chain exists to survive one member failing, so putting two models
 * from the SAME provider next to each other wastes a hop when the provider
 * itself is what went down. Members are interleaved across providers for that
 * reason, and only then by tier.
 */
export function buildChain(classified, limit) {
  const order = { top: 0, standard: 1, unpriced: 2, budget: 3 };
  const sorted = [...classified].sort((a, b) => {
    const t = order[a.tier] - order[b.tier];
    if (t !== 0) return t;
    // Within a tier, a larger context window is the more useful fallback.
    const ctx = (b.contextWindow || 0) - (a.contextWindow || 0);
    if (ctx !== 0) return ctx;
    return a.id.localeCompare(b.id);
  });

  const byProvider = new Map();
  for (const entry of sorted) {
    const provider = splitModelId(entry.id)?.provider || "";
    if (!byProvider.has(provider)) byProvider.set(provider, []);
    byProvider.get(provider).push(entry);
  }

  const chain = [];
  const queues = [...byProvider.values()];
  while (chain.length < limit) {
    let took = false;
    for (const queue of queues) {
      if (!queue.length) continue;
      chain.push(queue.shift().id);
      took = true;
      if (chain.length >= limit) break;
    }
    if (!took) break;
  }
  return chain;
}

// GET /api/combos/suggest?limit=5
export async function GET(request) {
  try {
    const limitParam = Number(new URL(request.url).searchParams.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(20, Math.floor(limitParam)) : 5;

    const models = await buildModelsList(["llm"]);

    // Advisory, exactly as it is for the default-model route: an unreadable
    // availability list means "nothing known to be exhausted", never "suggest
    // nothing".
    let unavailable = [];
    try {
      const response = await getAvailability();
      if (response.ok) unavailable = (await response.json()).models || [];
    } catch {
      /* fail open */
    }
    const blocked = buildBlocked(unavailable);

    const classified = [];
    for (const model of models || []) {
      if (typeof model?.id !== "string" || model.owned_by === "combo") continue;
      if (blocked.providers.has(model.owned_by)) continue;
      if (blocked.models.has(model.id)) continue;
      const entry = classifyModel(model.id);
      if (entry) classified.push(entry);
    }

    const tiers = { top: [], standard: [], budget: [], unpriced: [] };
    for (const entry of classified) tiers[entry.tier].push(entry.id);

    return NextResponse.json({ chain: buildChain(classified, limit), tiers, counted: classified.length });
  } catch (error) {
    console.log("Error suggesting a combo:", error);
    return NextResponse.json({ error: "Failed to suggest a combo" }, { status: 500 });
  }
}
