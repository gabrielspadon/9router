import { requireAdmin } from "@/lib/admin/guard.js";
import { adminError, adminJson } from "@/lib/admin/policy.js";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias } from "@/shared/constants/providers";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/admin/models — the catalog an inference caller picks a model from.
 *
 * Same source and same disabled-model filter as /api/models, projected to the
 * ABI's three required fields plus caps. Aliases are absent on purpose: an
 * alias is a dashboard convenience that a user can rename at any time, and the
 * ABI is a contract about routable identifiers.
 */
export async function GET(request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const disabled = await getDisabledModels();
    const models = AI_MODELS.filter((m) => {
      const alias = getProviderAlias(m.provider) || m.provider;
      return !(disabled[alias] || disabled[m.provider] || []).includes(m.model);
    }).map((m) => {
      const c = getCapabilitiesForModel(m.provider, m.model);
      return {
        model: m.model,
        provider: m.provider,
        fullModel: `${m.provider}/${m.model}`,
        caps: {
          vision: c.vision,
          search: c.search,
          reasoning: c.reasoning,
          contextWindow: c.contextWindow,
          maxOutput: c.maxOutput,
        },
      };
    });
    return adminJson({ models });
  } catch (error) {
    return adminError(500, "catalog_unavailable", error?.message || "Model catalog could not be read.");
  }
}
