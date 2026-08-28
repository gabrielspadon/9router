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

### 2026-08-28 — session 2 continued: batch 2 complete
- PR #3595 adapted + merged d0c8658..d0c8d6589 via worktree agent: claude-compat layer, model context windows, statistics dashboard, providers grid filters, opencode-go free-tier fixes. 4 conflicts kept fork state; PR's own test contradiction fixed; 38/38 targeted, gate green.
- Batch 2 run as parallel worktree workflow (4 agents): PR #3558 (groq models + modelsFetcher), #3560 (combo empty-stream failover #3463, 31/31), #3584 (quota pause buffer, 13 commits squashed, 23/23), #3589 (Responses output items + fork mock adaptation). All 4 merged to master 5ca0a732e, gate green 1914 pass / 92 known-fail, pushed f138640c8.
- Note: the 3589 worker's mock-fix commit had to be cherry-picked separately after the merge (worker left it on its branch; initial merge missed it).
- In flight: PR #3575 adaptation (worktree agent, tool disclosure with anchorClaudeCache kept canonical), batch-3 analysis workflow for PRs 3556/3555/3552/3551/3550.
- 12 of 824 upstream open PRs now processed (9 integrated, 1 adapted, plus session-1's 3).

### 2026-08-28 — session 2 continued: batches 3+4 complete
- Batch 3: PR #3550 (session LRU), #3551 (sql.js signal exit), #3552 (probe deadlines), #3555 (qoder refresh), #3575 (tool disclosure, adapted: anchorClaudeCache canonical). Merged 260b0409e, pushed fd90e3738.
- Batch 4: PR #3544 (usage ms dedupe; 3 known-fails retired), #3546 (ollama NDJSON), #3547 (responses decoder), #3548 (headroom mock), #3549 (commandcode role), #3556 (TTFT watchdog, adapted: 30s decoupled from shared constant). Merged b866e914d, gate green 2006 pass / 85 fail / 0 unexpected.
- 29 of 824 upstream open PRs processed (26 integrated, 3 adapted). 0 rejected so far; queue order is newest-first and upstream PRs are uniformly real fixes.
- Pattern established: analyze workflow (5 parallel agents) -> implement workflow (parallel worktree agents) -> sequential merges -> full gate -> tracking close -> push.

### 2026-08-28 — session 2 continued: security batch complete
- Security PRs prioritized over queue order: #3503 adapted (residual /api/headroom gap closed in LOCAL_ONLY_PATHS), #3501 integrated (JWT_SECRET fail-fast), #3497 adapted (OIDC discovery SSRF guard at single choke point), #3502 rejected with its residual fork bug fixed (raw API key masked in usage stats aggregates), #3496 rejected (would reintroduce spoofing bypass), #3495 integrated (Anthropic Message on forced-SSE retry). Merged 821a36a1c, gate green 2019 pass / 85 fail / 0 unexpected, pushed e81ebe57f.
- Notable: two upstream "security" PRs rejected with evidence — the fork's #3294 peer-token hardening is stronger; one PR's fix would reopen the hole it cites.
- 35 of 824 upstream open PRs processed (29 integrated, 4 adapted, 2 rejected).

### 2026-08-28 — session 2 continued: batch 6 complete (loop tick 2)
- Batch 5: PRs #3539-3543 integrated (selfhosted base URL, security-audit cwd fix, grok-cli 4.6, stream abort usage, oauth callback leak). Merged 87bd932c0, pushed df71d38db.
- Batch 6: PRs #3528, #3529, #3530 (adapted), #3531, #3534, #3537, #3538, #3582 (docs). Merged 735432bc2, gate green 66 known-fails / 0 unexpected, pushed.
- Workflow stall noted: one analysis run hung 45m with dead transcripts; killed and re-ran only the 3 missing agents fresh. Resume-from-cache blocked by affinity-injected script + guard (known friction; journal extraction used instead).
- One upstream mock-signature fix (3534) had to be cherry-picked separately after merge; worker leaves follow-ups on branches, verify ancestry before closing.
- 44 of 825 upstream open PRs processed (37 integrated, 5 adapted, 2 rejected).

### 2026-08-28 — session 2 continued: tick 3 complete
- Security batch 2: #3500 adapted (dual auth on database export/import, upstream PR itself broken — reimplemented), #3499 adapted (root-cause: settings PATCH gated on loopback-or-token even when requireLogin=false), #3498 rejected (superseded by LOCAL_ONLY middleware). Merged 82e943a09, pushed ce584b11b.
- Batch 7: #3522 (tunnel CSPRNG), #3523 (atomic sql.js persist), #3524/#3525 (cli-tools refuse-to-clobber + sibling routes + JSONC parser), #3526/#3527 (usage stream listener cleanup; same upstream commit, PRs crossed). Merged aa6d15f5e, gate green 2124 pass / 66 known-fail / 0 unexpected, pushed 8bc0ed41a.
- 53 of 825 upstream open PRs processed (44 integrated, 7 adapted, 2 rejected).

### 2026-08-28 — session 2 continued: tick 4 complete
- Batch 8: #3521 adapted (stream images kept, resolved against fork's delta.reasoning), #3520 (Claude stream once-guard), #3519 (tunnel health candidates), #3518 (provider error detail), #3517 (loopback proxy bypass). Merged 3f2fa7bd5, gate green 2165 pass / 66 known-fail / 0 unexpected, pushed.
- Catch: worker for 3517 fetched a stale FETCH_HEAD carrying 3519's commit; re-fetched the actual PR head, validated, merged. Verify fetched head's title against the PR before trusting.
- 58 of ~827 upstream open PRs processed (49 integrated, 7 adapted, 2 rejected).

## Verification commands
- `node scripts/tracking/sync-upstream.mjs --check`
- `cd tests && npx vitest run --reporter=json --outputFile=/tmp/vitest-results.json` then `node __baseline__/verify-no-regression.mjs /tmp/vitest-results.json`
