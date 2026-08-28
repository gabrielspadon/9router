# Upstream PRs — closed (processed)

## PR #3608 — Add error message for preventing abuse

- url: https://github.com/decolua/9router/pull/3608
- upstream-state: open (discovered 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: commit 6454fff56 on branch upstream-pr-3608, merged e063c21b3; adapted: added rule to fork's errorConfig.js at overloaded line; tests: tests/unit/error-config-abuse-rule.test.js (2 pass); full-suite gate green

## PR #3607 — feat(providers): add multi-protocol custom providers

- url: https://github.com/decolua/9router/pull/3607
- upstream-state: open (discovered 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 7d669a44e by chisewaguri on branch upstream-pr-3607 (base == fork master tip, clean apply), merged bff6d21a1; 33 focused tests pass; verify-providers + verify-alias byte-identical; eslint error count unchanged vs master (9 pre-existing set-state-in-effect); full-suite gate green 1809 pass / 90 known-fail / 0 new

## PR #3601 — fix(stream): keep delta.reasoning chunks in streaming passthrough

- url: https://github.com/decolua/9router/pull/3601
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 87c4aa798 on branch upstream-pr-3601, merged; streamHelpers/stream.js now accept delta.reasoning alongside reasoning_content; 3-test file added upstream passes; full-suite gate green (only xai-oauth env flake, passes solo)

## PR #3604 — feat: New Models Discovery for all connected providers

- url: https://github.com/decolua/9router/pull/3604
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-picks 0ffb4cada+bab242076 on branch upstream-pr-3604; one conflict resolved (page.js comment rename vs New Models block insertion, both kept); seenModels v2 migration applies; full-suite gate green

## PR #3592 — Feat/free model sync

- url: https://github.com/decolua/9router/pull/3592
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: 5 cherry-picks (bfb34f996..86b0f0265) on branch upstream-pr-3592, clean; free-model hourly auto-discovery sync with offline fixture tests (13 pass); full-suite gate green

## PR #3599 — feat(memory): modular AI memory management and context optimization pipeline

- url: https://github.com/decolua/9router/pull/3599
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-28
- detail: branch upstream-pr-3599, merged b47c238f7. Adaptations: cacheAnchor.js removed (fork anchorClaudeCache runs last and would strip the PR's mid-pipeline breakpoints; refs swept from index/chatCore/CLI/dashboard/docs/settings); toolPruner composes with RTK (content compression vs recency bounding); handoffStore kept as opt-in API, default off, no in-repo producer; tests ported node:test to vitest (5 pass). Full-suite gate green.

## PR #3595 — feat: claude-compat layer, model-context & statistics dashboard rework, ops tooling

- url: https://github.com/decolua/9router/pull/3595
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-28
- detail: merged 8960c78f as d0c8658..d0c8d6589 via worktree branch upstream-pr-3595-worktree. 4 conflicts resolved keeping fork state (freeModelSync boot, memory settings, seenModels, memory nav). opencode-go pinned catalog extended +3 free IDs. PR test contradiction fixed (ec7df6471). 38/38 targeted tests, baselines byte-equal, full gate green (only xai flake).

## PR #3558 — fix(groq): replace decommissioned models, add modelsFetcher

- url: https://github.com/decolua/9router/pull/3558
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick b848105f2 (andikadevs, Co-Authored-By stripped), branch upstream-pr-3558, merged f4ec78f46? no - 3558 merge; groq 3 dead ids replaced with 6 live, modelsFetcher+passthroughModels added; provider baseline byte-equal; full gate green

## PR #3560 — fix(combo): fail over on empty-but-successful streams (#3463)

- url: https://github.com/decolua/9router/pull/3560
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick e526cc5e9 (hiepau1231), combo failover on empty streams, 31/31 focused tests, gate green

## PR #3589 — fix: preserve Responses output items across provider translation

- url: https://github.com/decolua/9router/pull/3589
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 1a6561337 (longdang193) + fork adaptation c55c2db966 (usageDb mock needs trackPendingRequest); 10/10 focused; gate green

## PR #3584 — feat(quota): add configurable pause threshold for quota enforcement

- url: https://github.com/decolua/9router/pull/3584
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: merge 231203a6e of 13 upstream commits squashed; quota pause buffer per-account per-window, fail-open, TTL cache; 23/23 focused; gate green

