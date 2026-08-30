# Round 2 verification summary

Every number here was produced by a command in
`docs/design/verification/` and re-measured for this document. Where a gate
could not be met, it says so and why.

## Behaviour

| Check | Result |
|---|---|
| Repository-wide behavioural fingerprint against the merge base | 7152 entries at base, 7152 on branch, 2004 distinct on both. Identical. |
| Read-only path trespass, committed history and working tree | none |
| Checker sensitivity, five injected cases | 5 of 5 caught; a file rename stays legal, an altered handler, a removed fetch and a read-only edit all fail |

The fingerprint carries hook call sites, event-handler expression bodies, fetch
and axios calls with their arguments, request-path literals, state setters,
navigation calls and imports from the routing, store, model and API layers, as
one multiset over the whole source tree with no filename in the entries. A
control may move between components; it may not change.

## Capability parity

| Check | Result |
|---|---|
| Controls recorded before | 1430 across 23 routes |
| Controls recorded after | 1446 across 23 routes |
| Unreachable after the redesign | 0 |
| More than one action deep | 0 |

The walk records every interactive control that is visible, then opens each
non-destructive disclosure once and records what that reveals, so "one action
away" is measured rather than asserted. Nothing destructive is ever clicked.

## Browser audit, 168 views before and 168 after

Every audited route, both themes, wide desktop, laptop and phone, plus a 200
percent zoom pass.

| Measure | Baseline | Current | Result |
|---|---|---|---|
| console errors | 35 | 35 | unchanged |
| failed or 5xx requests | 0 | 0 | unchanged |
| contrast failures | 24 | 18 | improved |
| unnamed icon controls | 0 | 0 | unchanged |
| focus ring failures | 0 | 0 | unchanged |
| hue-only status indicators | 420 | 420 | unchanged |
| views overflowing at 200 percent zoom | 0 | 0 | unchanged |
| navigation failures | 0 | 0 | unchanged |
| unnamed keyboard stops | 61 | 61 | unchanged |

336 screenshots are committed under `docs/design/evidence/routes/`, converted
to WebP (30.4MB of PNG became 11.3MB) so the evidence travels with the pull
request without dominating the repository.

The hue-only figure is a round-2 measurement with no round-1 counterpart to
improve on. It counts small saturated elements carrying no text, icon or
accessible name. `StatusToken` is the component answer to it and the routes
that adopt it will move the number; the routes not yet migrated are why it has
not moved.

## Colour

76 declared pairs measured across both themes against the live token values,
0 below requirement. The pair list is `docs/design/tokens.pairs.json` and the
tables in the design system are generated, not written.

## Lint

175 findings in the changed files at the merge base, 175 on the branch. Zero
new. The comparison lints both sides in a throwaway worktree with the same
config and dependencies, and keys on file and rule rather than line, so a
finding that moved down a file is not counted as new.

## Test suite

The suite is not green on a plain checkout and is not judged by a raw count.

Run serially, the 17 files touching this branch's surface report 393 passed and
4 failed of 397. The four fail deterministically because they assert CSS class
names this branch deliberately replaced, and three of them fail because a defect
was fixed. Cause is proved per test against the merge base in
`docs/design/backend-handoff.md` finding 6.

A parallel run showed 19 additional failures. Those are vitest worker crashes
under contention, not defects: they pass on a serial re-run. This suite must be
run serially when it is being judged.

## Isolated instance

Built from source on port 20135 with `DATA_DIR=/tmp/9router-r2-data`, seeded by
a read-only `sqlite3 .backup` of the live database so the audit ran against
realistic routing data. The repository's own smoke test passes 9 of 9 against
it. Production on 20128 was never touched, never rebuilt over and never
restarted.

The helper script defaults to 20129, which is held by an unrelated 9Router
process this work does not own, so 20135 was used instead and the substitution
is recorded here.

## Localisation

Five locales across four routes, zero horizontal overflow anywhere. Persian
resolves `dir=ltr`, which is the pre-existing absence of right-to-left support
rather than a regression. Detail and evidence in
`docs/design/evidence/localisation-report.md`.
