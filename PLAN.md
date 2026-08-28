# 9Router fork integration — plan and status log

## Goal
Independently maintained fork of decolua/9router: process upstream PR + issue backlog, repo professionalization, visual polish, all work in gabrielspadon/9router only. Upstream read-only (push URL disabled).

## Session log (append only)

### 2026-08-28 — session 1: bootstrap
- Remotes: origin fetch=decolua push=gabrielspadon; upstream remote added with push DISABLED_NO_PUSH_TO_UPSTREAM
- Upstream backlog at seed: 822 open PRs, 999 open issues (paginated via gh api)
- tracking/ seeded: upstream-prs-open.md (822), upstream-issues-open.md (999), closed files empty
- scripts/tracking/sync-upstream.mjs written: idempotent append, --check validator (overlap → exit 1, tested with seeded dupe PR #3604)
- Baseline: root npm install + tests npm install; vitest run = 90 failed / 1779 passed / 59 skipped, 17 expected-fail, 26 files failing (pre-existing on upstream master, 0 divergence from upstream/master)
- Fixed tests/__baseline__/verify-no-regression.mjs path bug (split on /app/ never matched locally → all paths undefined → gate could not detect anything)
- Regenerated known-fails.txt from clean master run: 90 entries; gate now reports ✅ No regression
- README.md: Fork Status section added
- Baseline recorded. PR backlog processing begins next session.

### 2026-08-28 — session 2: first backlog items processed
- PR #3608 integrated: 1-line abuse-prevention backoff rule in errorConfig.js + test. Merged e063c21b3.
- PR #3607 integrated: cherry-pick 7d669a44e (multi-protocol custom providers), clean apply (base == master tip). 33 focused tests, provider/alias baselines byte-identical. Merged bff6d21a1.
- Issue #3606 implemented: Cloudflare Workers AI BGE embeddings (registry embeddingConfig + dedicated adapter resolving accountId from providerSpecificData). 4 new tests. Merged 6d37fe569.
- Fixed seed-glue bug: preamble "---" was glued to first entry heading in both open files, broke close-entry.py section splitting; repaired files + hardened close-entry.py regex (536211d3e).
- Full-suite gate green after every merge: 1813 pass / 90 known-fail / 0 new regressions.
- Sync at start and end: upstream 824 PRs / 1000 issues open, 0 new.

### 2026-08-28 — session 2 continued: batch integration (parallel mode)
- PR #3601 integrated (streaming delta.reasoning passthrough), PR #3604 integrated (New Models discovery, 1 conflict resolved), PR #3592 integrated (free-model auto-discovery, 13 tests). Merged 0afeb4c47, pushed.
- PR #3599 adapted and merged b47c238f7: cacheAnchor.js dropped (fork anchorClaudeCache supersedes), toolPruner composes with RTK, handoffStore kept opt-in default-off, tests ported node:test->vitest.
- Tracking tooling bug root-caused and fixed: close-entry.py rebound `entry` before the `is not` identity filter, so the open-file removal never happened; residuals were cleaned every time by hand. Fixed (530ee4534), live round-trip tested, PR #1 restored to open.
- xai-oauth-service 2-test flake confirmed env-dependent (passes solo), documented as non-blocking.
- In flight: PR #3595 adaptation in isolated worktree (subagent); batch-2 analysis workflow for PRs 3589/3584/3575/3560/3558.

## Verification commands
- `node scripts/tracking/sync-upstream.mjs --check`
- `cd tests && npx vitest run --reporter=json --outputFile=/tmp/vitest-results.json` then `node __baseline__/verify-no-regression.mjs /tmp/vitest-results.json`
