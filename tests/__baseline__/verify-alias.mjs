// Verify alias resolution is byte-for-byte stable (both directions, all sources).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { MEDIA_ONLY_ALIASES, resolveProviderAlias } from "../../open-sse/services/model.js";
import { PROVIDER_ID_TO_ALIAS, PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";

const here = dirname(fileURLToPath(import.meta.url));
const snapPath = join(here, "alias-baseline.json");

// Hidden for shell-access safety, so absent from REGISTRY, but still reachable
// through the specialized executor map and intentionally retained as a probe.
const HISTORICAL_NON_REGISTRY_TOKENS = ["devin-cli"];

const runtimeAliasTargets = new Map(Object.entries(MEDIA_ONLY_ALIASES));
for (const entry of REGISTRY) {
  runtimeAliasTargets.set(entry.id, entry.id);
  if (entry.alias) runtimeAliasTargets.set(entry.alias, entry.id);
  if (Array.isArray(entry.aliases)) {
    for (const alias of entry.aliases) runtimeAliasTargets.set(alias, entry.id);
  }
}

const runtimeTokenSet = new Set(runtimeAliasTargets.keys());
const ALIAS_TOKENS = [
  ...runtimeTokenSet,
  ...HISTORICAL_NON_REGISTRY_TOKENS,
].sort();

if (new Set(ALIAS_TOKENS).size !== ALIAS_TOKENS.length) {
  throw new Error("Alias verifier token universe contains duplicates");
}
const missingRuntimeTokens = [...runtimeTokenSet].filter((token) => !ALIAS_TOKENS.includes(token));
if (missingRuntimeTokens.length) {
  throw new Error(`Alias verifier missed runtime tokens: ${missingRuntimeTokens.sort().join(", ")}`);
}
const historicalRuntimeOverlap = HISTORICAL_NON_REGISTRY_TOKENS.filter((token) => runtimeTokenSet.has(token));
if (historicalRuntimeOverlap.length) {
  throw new Error(`Historical alias probes are now runtime-derived: ${historicalRuntimeOverlap.join(", ")}`);
}
const incorrectRuntimeMappings = [...runtimeAliasTargets]
  .filter(([token, expected]) => resolveProviderAlias(token) !== expected);
if (incorrectRuntimeMappings.length) {
  const details = incorrectRuntimeMappings
    .map(([token, expected]) => `${token}: expected ${expected}, got ${resolveProviderAlias(token)}`)
    .join("; ");
  throw new Error(`Alias verifier/runtime derivation mismatch: ${details}`);
}
const nonIdentityRuntimeCount = [...runtimeAliasTargets]
  .filter(([token, providerId]) => token !== providerId).length;

// Sort idToAlias by key — runtime accesses by key, order is irrelevant (content-based)
const sortedIdToAlias = Object.fromEntries(
  Object.keys(PROVIDER_ID_TO_ALIAS).sort().map(k => [k, PROVIDER_ID_TO_ALIAS[k]])
);
const resolved = {
  aliasToId: Object.fromEntries(ALIAS_TOKENS.map(a => [a, resolveProviderAlias(a)])),
  idToAlias: sortedIdToAlias,
  modelKeys: Object.keys(PROVIDER_MODELS).sort(),
};
const current = JSON.parse(JSON.stringify(resolved));

if (process.argv[2] === "--snapshot") {
  writeFileSync(snapPath, JSON.stringify(current, null, 2));
  console.log(`Snapshot alias resolution → ${snapPath}`);
  process.exit(0);
}
if (!existsSync(snapPath)) { console.error("No baseline. Run --snapshot first."); process.exit(1); }
const baseline = JSON.parse(readFileSync(snapPath, "utf8"));
if (JSON.stringify(baseline) === JSON.stringify(current)) {
  console.log(`✅ Alias resolution byte-for-byte equal (${ALIAS_TOKENS.length} tokens; ${nonIdentityRuntimeCount} non-identity mappings).`);
  process.exit(0);
}
// Diff
for (const a of ALIAS_TOKENS) {
  if (baseline.aliasToId[a] !== current.aliasToId[a]) {
    console.error(`~ alias ${a}: ${baseline.aliasToId[a]} -> ${current.aliasToId[a]}`);
  }
}
if (JSON.stringify(baseline.idToAlias) !== JSON.stringify(current.idToAlias)) console.error("~ idToAlias changed");
if (JSON.stringify(baseline.modelKeys) !== JSON.stringify(current.modelKeys)) console.error("~ modelKeys changed");
process.exit(1);
