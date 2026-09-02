import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getPricingForModel } from "open-sse/providers/pricing.js";

/**
 * Cost tiering for a "provider/model" id, shared by everything that has to
 * choose between models on the user's behalf: the combo suggester (#1033,
 * #1091) and the auto router (#1386).
 *
 * Nothing here is a new source of truth. Pricing comes from the table the usage
 * layer already bills against and capabilities from the resolver routing uses;
 * this only orders them.
 *
 * The tier is decided by OUTPUT price, because that is the number that actually
 * differs between a flagship and a workhorse and the one a user is trying to
 * avoid spending. A model with no published price is "unpriced" rather than
 * free: guessing it into the cheap tier would put an unknown cost first.
 */

// Output dollars per million tokens. Both boundaries sit in the gap between the
// clusters the published tables actually form, rather than on a round number.
export const TOP_TIER_MIN_OUTPUT = 5;
export const BUDGET_TIER_MAX_OUTPUT = 1;

export function splitModelId(id) {
  if (typeof id !== "string") return null;
  const slash = id.indexOf("/");
  if (slash <= 0 || slash === id.length - 1) return null;
  return { provider: id.slice(0, slash), model: id.slice(slash + 1) };
}

export function classifyModel(id) {
  const parts = splitModelId(id);
  if (!parts) return null;
  const price = getPricingForModel(parts.provider, parts.model);
  const caps = getCapabilitiesForModel(parts.provider, parts.model) || {};
  const output = typeof price?.output === "number" ? price.output : null;

  let tier;
  if (output === null) tier = "unpriced";
  else if (output >= TOP_TIER_MIN_OUTPUT) tier = "top";
  else if (output <= BUDGET_TIER_MAX_OUTPUT) tier = "budget";
  else tier = "standard";

  return {
    id,
    tier,
    outputPricePerMillion: output,
    contextWindow: typeof caps.contextWindow === "number" ? caps.contextWindow : null,
    reasoning: caps.reasoning === true,
    vision: caps.vision === true,
  };
}
