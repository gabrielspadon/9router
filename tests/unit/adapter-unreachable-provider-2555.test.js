import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("../../src/sse/handlers/chat.js", import.meta.url), "utf8");
const auth = readFileSync(new URL("../../src/sse/services/auth.js", import.meta.url), "utf8");

// The capacity adapter prepends its pool ahead of the model the user asked for,
// because it only fires when nothing requested satisfies a required capability.
// A pool entry whose provider was never connected cannot satisfy anything, and
// attempting it spent the first fallback slot and logged "No credentials for
// qwen" against a Kiro request that never mentioned qwen (#2555).
//
// The filter is a small pure reduction over the augmented list; the surrounding
// handler is a Next route over the live DB, so the reduction is reimplemented
// against fixtures and the wiring is asserted from source.
function reachableAugmentation(base, augmented, reachable) {
  const added = augmented.filter((m) => !base.includes(m));
  if (added.length === 0) return { models: augmented, adapterAdded: added };
  const providerOf = (m) => String(m).split("/")[0];
  const usable = added.filter((m) => reachable.has(providerOf(m)));
  if (usable.length === added.length) return { models: augmented, adapterAdded: added };
  return { models: [...usable, ...base], adapterAdded: usable };
}

const KIRO = ["kr/claude-sonnet-5-thinking"];

describe("an unreachable adapter model never enters the chain (#2555)", () => {
  it("drops a pool entry whose provider has no connection", () => {
    const { models, adapterAdded } = reachableAugmentation(
      KIRO, ["qwen/qwen3-vl", ...KIRO], new Set(["kr", "kiro"]));
    expect(models).toEqual(KIRO);
    expect(adapterAdded).toEqual([]);
  });

  it("keeps one that is reachable, still ahead of the requested model", () => {
    // Ordering is deliberate: the adapter fires only when nothing requested can
    // do the job, so it has to be tried first.
    const { models, adapterAdded } = reachableAugmentation(
      KIRO, ["oc/mimo-v2.5-free", ...KIRO], new Set(["oc", "kr"]));
    expect(models).toEqual(["oc/mimo-v2.5-free", ...KIRO]);
    expect(adapterAdded).toEqual(["oc/mimo-v2.5-free"]);
  });

  it("keeps the reachable half of a mixed pool", () => {
    const { models } = reachableAugmentation(
      KIRO, ["qwen/qwen3-vl", "oc/mimo-v2.5-free", ...KIRO], new Set(["oc", "kr"]));
    expect(models).toEqual(["oc/mimo-v2.5-free", ...KIRO]);
  });

  it("leaves the list alone when the adapter added nothing", () => {
    const augmented = [...KIRO];
    const { models, adapterAdded } = reachableAugmentation(KIRO, augmented, new Set());
    expect(models).toBe(augmented);
    expect(adapterAdded).toEqual([]);
  });

  it("never drops a model the user actually asked for", () => {
    // Even with nothing reachable, the requested model survives: its own
    // credential lookup is what should report a problem with it.
    const { models } = reachableAugmentation(KIRO, ["qwen/qwen3-vl", ...KIRO], new Set());
    expect(models).toEqual(KIRO);
  });
});

describe("the handler and the credential layer are wired for it", () => {
  it("auth exposes the reachable-provider set", () => {
    expect(auth).toContain("export async function getReachableProviders()");
    expect(auth).toContain("connection?.isActive === false");
    // The set used to be derived from FREE_PROVIDERS, which is the providers
    // whose registry category is exactly "free". noAuth is orthogonal to that
    // category, so eight credential-free providers were missing from it (#3269).
    // What #2555 needs is that the set carries every no-auth provider, whatever
    // bucket it sits in.
    expect(auth).toMatch(/new Set\(NO_AUTH_PROVIDER_IDS\)/);
  });

  it("a repo failure does not take routing down", () => {
    const i = auth.indexOf("export async function getReachableProviders()");
    expect(auth.slice(i, i + 900)).toContain("catch");
  });

  it("all three augmentation sites go through the filter", () => {
    expect(chat.match(/reachableAugmentation\(/g)?.length).toBe(4); // 1 definition + 3 call sites
  });

  it("no site still derives adapterAdded by re-filtering the augmented list", () => {
    expect(chat).not.toMatch(/adapterAdded = augmentedModels\.filter/);
    expect(chat).not.toMatch(/adapterAdded = soloAugmented\.filter/);
  });
});
