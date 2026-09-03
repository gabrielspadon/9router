# OpenCode reasoning effort scope

Priority: P1
Status: Fixed, but not the way this doc prescribed — see correction below (this doc's own root-cause diagnosis was superseded, not just its status).

## Current behavior

Correction: `thinkingLevels.js:130-133`'s precedence chain (`routeFmt = PROVIDERS[provider]?.thinkingFormat || openai-compatible check`, `fmt = routeFmt || caps.thinkingFormat`) is UNCHANGED today — still unconditional for every provider, no `oc/`-prefix gate, exactly as described below. But `tests/unit/reconciliation/opencode-effort-scope.test.js` (landed alongside the actual fix) asserts this broad precedence is *correct* for eight non-OpenCode providers by name (`meta`, `ollama`, `tokenrouter`, `openrouter`, `vercel-ai-gateway`, `venice`, `nube`, `siliconflow`) plus `openai-compatible-*` and `cloudflare-ai` — the reconciliation determined narrowing to `oc/`-only, as this doc's "Required behavior" prescribes, would have been wrong. The actual defect was one level lower, in `PATTERN_THINKING`: an unscoped `*codex*` pattern entry (no `provider` field) matched on the model NAME and outranked the route's own declared format. The fix scopes name-only pattern entries to defer to a declared route format while leaving `provider`-scoped pattern entries authoritative (test comment, `opencode-effort-scope.test.js:1-12`) — a different code path than the `:130-133` chain this doc's Blast Radius names.

- Core reasoning-effort forwarding exists and works: `open-sse/providers/thinkingLevels.js` resolves valid thinking levels per model, reusing `capabilities.js`'s `thinkingFormat`/`canDisable` so level sets stay defined in one place (file header, `:1-2`).
- The gap is precedence, not forwarding. `open-sse/providers/thinkingLevels.js:124` opens the comment block (`// Provider-declared format wins over per-model caps (same precedence as thinkingUnified.resolveFormat)...`) whose code follows at `:130-133`:
  ```js
  const fmt =
    (provider && PROVIDERS[provider]?.thinkingFormat) ||
    (typeof provider === "string" && provider.startsWith("openai-compatible-") ? "openai" : null) ||
    caps.thinkingFormat;
  ```
  `PROVIDERS[provider]?.thinkingFormat` — a provider-wide declaration — is checked first and wins over the per-model `caps.thinkingFormat` for *every* provider, unconditionally. There is no `oc/`-prefix (or any OpenCode-route-specific) check anywhere in this file — a `grep` for `oc/` and `"oc"` in `thinkingLevels.js` returns nothing.
  - Per the Branch Family Reconciliation table, the predecessor's own correction `fe41dec32` narrowed this same broad precedence to apply only to `oc/`-prefixed routes; TokenProxy's version still applies it broadly, which is exactly what the matrix's status ("Partial") and Decision ("Reconcile manually against current provider-level behavior. Do not cherry-pick the old file.") describe.
- No acceptance test in the Acceptance Tests table names this behavior directly — see below.

## Required behavior

Provider-declared `thinkingFormat` should win over a model's own per-model capability only for OpenCode-routed requests (the `oc/`-prefixed model-id space), matching what the predecessor correction narrowed to. For every other provider, the per-model `caps.thinkingFormat` remains authoritative — broad provider-level override is the exception scoped to OpenCode's routing quirk (every OpenCode model funnels through one gateway enum regardless of the upstream vendor its ID resembles, per the comment at `:126-127`), not a general precedence rule for all providers. This is a manual reconciliation against current provider-level behavior — the old predecessor file is not cherry-picked wholesale, since Branch Family Reconciliation already shows a bulk replay here would overwrite newer registry and provider work.

Failure direction: a model ID that does not clearly indicate `oc/` routing (malformed, ambiguous, or a new provider prefix not yet classified) falls back to the narrower per-model `caps.thinkingFormat` path, never to the broad provider-override path — an unclassified route must not accidentally inherit OpenCode's exception.

## Acceptance test

No row in the Acceptance Tests table names this capability — the closest listed test, "Tier fidelity," covers Codex service tiers specifically (row 06) and does not generalize to reasoning-effort precedence for OpenCode. The matrix's own Decision column is the authoritative required-proof statement for this row instead, quoted verbatim as "Required proof": "Reconcile manually against current provider-level behavior. Do not cherry-pick the old file."

Vitest translation:

- Fixture: a fake `PROVIDERS` map with two entries — one whose `thinkingFormat` differs from its model's own `caps.thinkingFormat` (to make a precedence bug visible), scoped once as an `oc/`-prefixed model ID and once as a plain (non-OpenCode) model ID for the same underlying provider shape.
- Case 1 (`oc/<model>`): assert the resolved `fmt` equals the *provider-declared* format — the current, already-correct behavior for the routing case the exception exists for.
- Case 2 (plain, non-`oc/` model ID, same conflicting provider/caps formats): assert the resolved `fmt` equals the *per-model* `caps.thinkingFormat`, not the provider-wide one — this is the regression check for the gap found above, and fails against the current unconditional `:130-133` precedence.
- Case 3 (unclassified/malformed provider prefix, conflicting formats): assert it resolves to `caps.thinkingFormat`, proving the failure direction — no accidental broad-override inheritance for an unrecognized route.
- Proposed file: `tests/unit/reconciliation/opencode-reasoning-effort-scope.test.js`.

## Blast radius

- `open-sse/providers/thinkingLevels.js` — the `:130-133` precedence chain gains an `oc/`-route check ahead of the unconditional `PROVIDERS[provider]?.thinkingFormat` branch.
- `tests/unit/reconciliation/opencode-reasoning-effort-scope.test.js` — new.

No DB migration. This is a pure resolution-logic change with no persisted state.
