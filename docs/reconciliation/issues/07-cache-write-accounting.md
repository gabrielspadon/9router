# Cache-write accounting

Priority: P1
Status: Partial

## Current behavior

- `open-sse/utils/usageTracking.js:220` (`const cacheCreation = num(usage.cache_creation_input_tokens ?? usage.prompt_tokens_details?.cache_creation_tokens);`) already recognizes two spellings of cache-creation (cache-write) evidence: the top-level `cache_creation_input_tokens` field and the nested `prompt_tokens_details.cache_creation_tokens` shape. This is the ingestion side, and it already handles writes.
- `open-sse/translator/concerns/usage.js:109` is `export function toResponsesUsage(raw)`, the function that converts Chat-Completions-shaped usage into the Responses-API field names Codex and OpenCode expect. Inside it (`:122-127`), only `cachedTokens` (cache *reads*, sourced from `input_tokens_details.cached_tokens`, `prompt_tokens_details.cached_tokens`, or bare `cached_tokens`) is copied into the output `usage.input_tokens_details.cached_tokens`. There is no equivalent line writing a cache-creation field into the Responses-API output shape — cache-write evidence that `usageTracking.js` already captured on ingestion is dropped on this specific export path.
- Neither `usageTracking.js` nor `usage.js` reads the common `cache_write_tokens` spelling (as opposed to `cache_creation_input_tokens`/`cache_creation_tokens`) anywhere in either file — a provider that emits that spelling produces zero recognized cache-write tokens through either path.

## Required behavior

Normalize both cache-read and cache-write aliases once, in one shared place, rather than per-consumer: the read aliases (`cached_tokens`, `input_tokens_details.cached_tokens`, `prompt_tokens_details.cached_tokens`) and the write aliases (`cache_creation_input_tokens`, `prompt_tokens_details.cache_creation_tokens`, and the currently-unhandled `cache_write_tokens`) both funnel through one normalization step. That normalized `{cachedTokens, cacheCreationTokens}` pair then carries through every aggregate that touches usage: the per-request receipt, the per-account rollup, `usageDaily` (schema.js's daily table), and cost computation — not just the ingestion step that already has it right.

Failure direction: an unrecognized or malformed cache field (a non-numeric value, a field present but `null`) normalizes to `0` for that specific sub-total, never `NaN` propagating into a cost aggregate and never silently inflating a different total (e.g. folding an unparseable cache-write value into the read count instead of dropping it).

## Acceptance test

Required proof (Acceptance Tests, "Cache truth"): "Provider aliases for cache reads and writes produce identical canonical request, account, daily, and cost totals. Account switching is visible beside cache loss."

Vitest translation:

- Fixture: three raw usage payloads for the same logical request, each spelling cache-write differently — `cache_creation_input_tokens` (top-level), `prompt_tokens_details.cache_creation_tokens` (nested), and `cache_write_tokens` (the currently-unhandled spelling) — all with identical numeric values otherwise.
- Run each through the shared normalization function and assert all three produce byte-identical `{cachedTokens, cacheCreationTokens}` output — the "canonical...totals" requirement.
- Run the normalized output through `toResponsesUsage` (`usage.js:109`) and assert the Responses-API output now includes the cache-creation figure, not just `cached_tokens` — this is the regression check for the specific gap found above.
- Feed the same three payloads through the daily/account aggregation function (wherever `usageDaily` rows are built) and assert identical daily and per-account cache-write totals across all three spellings.
- Account-switch case: simulate a mid-session repin (row 03) between two accounts, each reporting cache reads before the switch and a cache miss (zero cached tokens, full cache-creation cost) immediately after; assert the aggregate surfaces both the account-switch event and the accompanying cache-read drop to zero in the same window, rather than smoothing it into one blended number.
- Proposed file: `tests/unit/reconciliation/cache-write-accounting.test.js`.

## Blast radius

- `open-sse/utils/usageTracking.js` — add the `cache_write_tokens` alias to the existing `:220` normalization.
- `open-sse/translator/concerns/usage.js` — `toResponsesUsage` (`:109`) gains an output field for cache-creation tokens alongside the existing `cachedTokens` line at `:122-127`.
- Daily/account/cost aggregation code (wherever `usageDaily` and per-account usage rows are written, downstream of `usageTracking.js`) — confirm it reads the now-normalized `cacheCreationTokens` field rather than re-deriving it from a raw payload.
- `tests/unit/reconciliation/cache-write-accounting.test.js` — new.

No DB migration. `requestStats` already carries dedicated `cachedTokens`/`cacheCreationTokens` integer columns (`src/lib/db/schema.js:199-200`), so once the fix above lands, the right values reach existing columns. `usageHistory` and `usageDaily` (also present in the 13-entry `TABLES`) store their per-record and per-day figures as opaque JSON blobs (`tokens`/`meta` on `usageHistory`, `data` on `usageDaily`) rather than dedicated cache columns — this row changes what gets serialized into those blobs, not their shape, so no schema change is needed there either.
