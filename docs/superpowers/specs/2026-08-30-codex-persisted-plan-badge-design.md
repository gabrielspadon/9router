# Codex Persisted Plan Badge Adaptation

**Date:** 2026-08-30
**Status:** Approved recommended adaptation of upstream PR #3210. Ready for implementation planning.

## Decision

Show a compact Codex subscription-plan badge only on Codex connection rows. The
badge derives synchronously from the already loaded connection record. It uses
`providerSpecificData.codexSubscriptionPlan` first, then the legacy
`providerSpecificData.chatgptPlanType` value. A blank, non-string, or
case-insensitive `unknown` value is unusable and falls through to the next
candidate. If neither candidate is usable, no badge renders.

The feature has one production owner,
`src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js`. The provider
detail page already obtains safe connection records from `/api/providers` and
passes each whole record to that row. It needs no new state, callback, effect,
request, refresh, or write. `ProviderLimits` is explicitly out of scope.

## Current Constraints

The upstream patch fetches `/api/usage/<connectionId>` once per Codex row so a
live response can override stored state. In this fork that endpoint can refresh
credentials and persist subscription metadata. Rendering a dashboard list must
not trigger provider traffic or state mutation. The current subscription work
already persists `codexSubscriptionPlan` through the usage route and preserves
`chatgptPlanType` for older Codex credentials, so both inputs are locally
available when the connection list arrives.

`ProviderLimits` already owns quota and subscription-expiry presentation. Its
quota state is not a source of truth for this connection-list badge. Extending
it would couple a static provider-page label to quota polling and enlarge the
scope unnecessarily.

## Approaches Considered

### Probe live usage for every visible connection

Rejected. It creates an N-plus-one render-time `/api/usage` pattern, may cause
remote refreshes and persistence, and makes opening the provider page depend on
quota endpoint availability.

### Thread a plan map through the provider-detail page

Rejected. A page-level map still needs a source and lifecycle. Using the
already persisted connection field directly is smaller, deterministic, and
remains current after the page's normal `fetchConnections` reload.

### Resolve the persisted label inside `ConnectionRow`

Selected. A pure exported helper in `ConnectionRow.js` receives one connection,
filters it to `provider === "codex"`, and returns the first usable persisted
plan. The component renders that one result with the existing `Badge` component.
This keeps data selection, display, and tests in the smallest existing UI
boundary.

## Data and Display Contract

`getPersistedCodexPlan(connection)` returns `null` for a non-Codex connection.
For a Codex connection it evaluates these candidates in order.

1. `connection.providerSpecificData.codexSubscriptionPlan`
2. `connection.providerSpecificData.chatgptPlanType`

Each candidate is accepted only when it is a string whose trimmed value is
non-empty and not `unknown` after case-folding. The returned label is the
trimmed original spelling. An invalid preferred value does not hide a valid
legacy value. A valid preferred value always wins over a valid legacy value.

The row renders a small primary `Badge` in its existing status-badge group,
after the authentication badge. The visible text is the selected plan. It also
includes visually hidden text, `Codex subscription plan`, so assistive
technology announces an unambiguous label without changing the compact visual
layout. The badge is absent rather than rendered empty for unavailable data.

No render path may call `fetch`, `/api/usage`, a remote provider, a refresh
helper, a connection update, or a state setter for plan data. The implementation
adds no `useEffect`, callback, page state, API route, persistence code, or
`ProviderLimits` change.

## Strict Test Boundary

Add `tests/unit/codex-plan-badge.test.js`. It imports only the named pure
`getPersistedCodexPlan` helper from `ConnectionRow.js` and uses a throwing
`globalThis.fetch` mock to prove resolving the display label has no network
dependency. The focused cases are these.

| Case | Required result |
| --- | --- |
| Both persisted plans are valid | `codexSubscriptionPlan` wins unchanged except trimming. |
| Preferred value is blank or unknown | A valid legacy `chatgptPlanType` is returned. |
| Both values are blank, unknown, missing, or non-strings | `null` is returned. |
| Connection is not Codex | `null` is returned even when it carries either field. |
| Focused helper calls | The mocked `fetch` has zero calls. |

The implementation review also verifies that the provider-detail page receives
no plan state or `/api/usage` fetch, and that
`src/app/(dashboard)/dashboard/usage/components/ProviderLimits/` has no diff.
Run the new focused test with the existing Codex subscription UI and route
tests, then lint only the changed row and test files. The repository no-regression
verifier and a production build remain final integration gates, not a claim that
this presentation-only subproject changes quota behavior.

## Non-goals

- Live usage probes, remote subscription refreshes, or plan writes.
- Any `ProviderLimits` component or utility change.
- Quota-card plan display, expiry formatting, account selection, OAuth parsing,
  API response changes, migrations, or provider-registry changes.
- Altering the connection list's normal loading and refresh lifecycle.

## Design Self-Review

This design names one display owner and one test boundary, gives a complete
precedence and invalid-value policy, makes the no-network invariant explicit,
keeps legacy credentials useful, and excludes quota presentation. It contains
no placeholder, external decision, or implementation ambiguity.
