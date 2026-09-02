import { NextResponse } from "next/server";
import { buildModelsList } from "@/app/api/v1/models/route.js";
import { GET as getAvailability } from "@/app/api/models/availability/route.js";
import { PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";

export const dynamic = "force-dynamic";

/**
 * First model a new combo can safely start with (#2114).
 *
 * Members are skipped when /api/models/availability reports them on cooldown or
 * unavailable, so a combo is never seeded with a model that is already out of
 * quota. Combo entries are skipped too: seeding a combo with another combo is
 * how a routing cycle starts, and validateComboAcyclic would reject it anyway.
 */
export function pickFirstAvailableModel(models, unavailable) {
  const blockedModels = new Set();
  const blockedProviders = new Set();
  for (const entry of unavailable || []) {
    if (!entry?.provider) continue;
    const alias = PROVIDER_ID_TO_ALIAS[entry.provider] || entry.provider;
    // "__all" is the account-level form (401, payment required): the whole
    // provider is out, not one model.
    if (!entry.model || entry.model === "__all") {
      blockedProviders.add(alias);
      blockedProviders.add(entry.provider);
      continue;
    }
    blockedModels.add(`${alias}/${entry.model}`);
    blockedModels.add(`${entry.provider}/${entry.model}`);
  }

  for (const model of models || []) {
    if (typeof model?.id !== "string" || model.owned_by === "combo") continue;
    if (blockedProviders.has(model.owned_by)) continue;
    if (blockedModels.has(model.id)) continue;
    return model.id;
  }
  return null;
}

// GET /api/combos/default-model
export async function GET() {
  try {
    const models = await buildModelsList(["llm"]);

    // Availability is advisory. A failure there must not cost the caller a
    // suggestion, so an unreadable list means "nothing known to be exhausted".
    let unavailable = [];
    try {
      const response = await getAvailability();
      if (response.ok) unavailable = (await response.json()).models || [];
    } catch {
      /* fail open */
    }

    const model = pickFirstAvailableModel(models, unavailable);
    return NextResponse.json(
      model ? { model } : { model: null, reason: "no-available-model" },
    );
  } catch (error) {
    console.log("Error picking default combo model:", error);
    return NextResponse.json({ error: "Failed to pick a default model" }, { status: 500 });
  }
}
