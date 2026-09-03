# Compound quota account ordering

Priority: P0
Status: Partial

## Current behavior

Quota evidence today only gates eligibility (pass/fail); it never ranks the accounts that pass.

- `src/shared/utils/quotaPause.js:50` `getPausedWindow(connection)` walks `connection.lastQuotaSnapshot.windows`, skips windows marked `unlimited` or without a configured threshold (`normalizeWindowThreshold`, line 42, clamps to 0-100), and returns the first window whose `remainingPercentage` is at or below its threshold. It answers "is this account paused right now," nothing more.
- `src/sse/services/auth.js:222` calls `evaluateQuota(c)` (`src/sse/services/quotaGuard.js:107`) for every candidate connection inside `getProviderCredentials` and drops any connection that comes back paused from `availableConnections`. `evaluateQuota` is deliberately fail-open: a missing or errored quota read never pauses an account (`quotaGuard.js:15`, `:108-109`).
- `src/sse/services/auth.js:272` reads `providerOverride.fallbackStrategy || settings.fallbackStrategy || "fill-first"`. The two implemented strategies are `"round-robin"` (line 287: sorts `routedConnections` by `lastUsedAt` recency, rotates once `consecutiveUseCount` exceeds `stickyRoundRobinLimit`, default 3, at line 288) and the implicit fill-first fallback (first eligible connection by static `priority`). Neither strategy reads `remaining`, `limit`, `resetAt`, or `confidence` from the quota snapshot — quota only removes ineligible accounts before the strategy runs.

No function in the codebase normalizes simultaneous windows (five-hour, seven-day, thirty-day) into one ranked order, and nothing computes "soonest-expiring usable entitlement." Both `src/sse/services/auth.js:222` and `:272` cited by the matrix are accurate as cited.

## Required behavior

This is a scheduling row; it is bound by Account Scheduling Contract rules 1-3.

1. **Normalize evidence.** Every provider's general-use quota read becomes a window record with `scope`, `remaining`, `limit`, `resetAt`, `observedAt`, `confidence`. Five-hour, seven-day, thirty-day, and any future window use one shared type. A provider that has no thirty-day window simply omits that record; the ranking function must not require a fixed window set. The current `lastQuotaSnapshot.windows` shape (`w.key`, `w.unlimited`, `w.remainingPercentage`) is a percentage-only projection of this and needs `remaining`/`limit` split back out plus `observedAt`/`confidence` added.
2. **Eligibility.** An account is eligible only when every known hard window still has usable headroom and the credential is healthy. Unknown evidence (no read yet, or a read that errored) must not outrank an account with fresh known evidence, but it must not take the whole provider offline either — the existing fail-open behavior in `quotaGuard.js` already satisfies the "don't take the provider offline" half; the "don't let unknown outrank known" half does not exist because there is no ranking to outrank in the first place.
3. **Ranking.** Rank eligible accounts by soonest-expiring *usable* entitlement across all applicable windows: a sooner reset is more urgent, but a constraining longer window (e.g., a tight thirty-day cap) must prevent draining a short window past what the longer window allows. Deterministic account priority (the existing static `priority` field) is the tie-breaker only, never the primary key.

Failure direction: a connection with no quota snapshot at all remains eligible (never paused, per existing fail-open behavior) but must sort behind every account that has fresh usable evidence — absence of evidence is not urgency. A window record with a non-finite `remaining`/`limit` or an unparseable `resetAt` is treated as unknown for that window only, not as full headroom and not as a pause trigger for the whole account.

## Acceptance test

Required proof (Acceptance Tests, "Compound windows"): "Fake-clock cases for accounts with five-hour plus seven-day, seven-day only, and five-hour plus seven-day plus thirty-day windows select the account with the most urgent expiring usable entitlement without violating any longer window."

Vitest translation:

- Fixture: three fake `connection` objects (`acct-5h7d`, `acct-7d-only`, `acct-5h7d30d`), each carrying a `lastQuotaSnapshot` built with explicit `remaining`/`limit`/`resetAt`/`confidence` per window, no real provider call.
- Fake clock: `vi.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00Z"))`, so `resetAt` deltas are deterministic; advance with `vi.setSystemTime` between sub-cases rather than real timers.
- Cases:
  1. `acct-5h7d` (5h resets in 10 min, 7d resets in 3d, both with headroom) vs `acct-7d-only` (7d resets in 1h) — assert the ranking function returns `acct-7d-only` first (soonest reset wins when neither window is exhausted).
  2. `acct-5h7d30d` where the 30d window is nearly exhausted (`remaining` close to 0) even though the 5h window resets soonest — assert the constraining longer window suppresses the 5h urgency and a different account ranks first, proving "without violating any longer window."
  3. Two accounts with identical window shapes and reset times, differing only in static `priority` — assert the lower-priority-number account wins, proving priority is the tie-break only.
- Assertion shape: `expect(rankAccounts(fixtures, { now }).map(a => a.id)).toEqual([...])` against the exact expected order per case, not just `.toBe(fixtures[0])`.
- Proposed file: `tests/unit/reconciliation/compound-quota-account-ordering.test.js`.

## Blast radius

- `src/shared/utils/quotaPause.js` — extend the window-record shape emitted from provider quota reads to carry `scope`/`remaining`/`limit`/`resetAt`/`observedAt`/`confidence` instead of the current `remainingPercentage` projection.
- New module (e.g. `src/shared/utils/quotaRank.js`) — the pure ranking function exercised above; keeping it pure and clock-injectable is what makes the fake-clock cases possible without a real provider.
- `src/sse/services/auth.js` — the `:272` `fallbackStrategy` branch gains a ranking-based path that calls the new module instead of (or ahead of) `round-robin`/fill-first.
- `tests/unit/reconciliation/compound-quota-account-ordering.test.js` — new.

No DB migration needed. Ranking reads the connection's live `lastQuotaSnapshot`, which is not persisted through `src/lib/db/schema.js` today; `TABLES` (`schema.js:21`) has 13 entries, not the 14 the migration-facts note claims, and none of them is a quota-window table. If a later row (persisted switch reason, see row 03) adds one, it lands as a new `TABLES` entry picked up by the additive auto-sync at `migrate.js:43-73` — no `SCHEMA_VERSION` bump required for this row on its own.
