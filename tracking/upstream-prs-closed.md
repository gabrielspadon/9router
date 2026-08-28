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

## PR #3550 — fix(session): evict the least-recently-used session, not the first one stored

- url: https://github.com/decolua/9router/pull/3550
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick b90f5ae0d (Nguyen Thanh Dat) as 804b7396f; LRU eviction via delete+set re-insert matching resolveContinuationId; 27/27 focused tests; gate green 1984/90/2133

## PR #3551 — fix(db): let the sql.js adapter exit on SIGINT/SIGTERM

- url: https://github.com/decolua/9router/pull/3551
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick c3651c923 as bb2a907f0; sqljsAdapter now exits on signal after flush, matching native adapters; 5/5 shutdown tests; gate green

## PR #3552 — fix(providers): give every connection probe a deadline

- url: https://github.com/decolua/9router/pull/3552
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: merge ed2834b13 of upstream 5fc3afef9; fetchWithTimeout abort-based helper + 27 probes converted; 8/8 tests, one import conflict resolved; gate green

## PR #3555 — feat(qoder): refresh model catalog, add capability mapping and image pass-through

- url: https://github.com/decolua/9router/pull/3555
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 7d226ef34 as 38aa64026 (hangyu); qoder catalog + PROVIDER_CAPABILITIES + image pass-through; 58/58 focused; gate green

## PR #3575 — feat(tool-disclosure): progressive tool disclosure — static filter + BM25 session index

- url: https://github.com/decolua/9router/pull/3575
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-28
- detail: merge b4c0b7170. Kept: toolFilter + BM25 toolDisclosure (default off) after dedupeTools, settings, UI, stats route, 46/46 tests. Dropped: PR's cache_control mid-pipeline re-stamping (fork anchorClaudeCache is sole source of truth), PR's weak CI workflow, PR design-pr doc. Signature keeps both memorySettings and toolDisclosure params. Gate green

## PR #3556 — fix(stream): add TTFT watchdog to prevent hangs when upstream stalls before first byte

- url: https://github.com/decolua/9router/pull/3556
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-28
- detail: cherry-pick 7d593ca06 (vianhanif) + adaptation ac18f7426: 30s ttft default decoupled from STREAM_FIRST_CHUNK_TIMEOUT_MS (stays 200s for combo peek + kiro repair in fork); 2 new watchdog tests, 33/33 targeted; gate green 2006 pass / 85 fail / 0 unexpected

## PR #3549 — fix(commandcode): open the error chunk with the assistant role

- url: https://github.com/decolua/9router/pull/3549
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 83a7a7ad8; commandcode error chunk role fix; 12/12 focused; gate green

## PR #3548 — fix(tests): stop the headroom mock from breaking when an export is added

- url: https://github.com/decolua/9router/pull/3548
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick d0840b97b; headroom mock widened via importOriginal; 3/3 focused; gate green

## PR #3547 — fix(responses): keep one decoder for the stream and drain the last event

- url: https://github.com/decolua/9router/pull/3547
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick; responses transform single decoder + flush drain; 4/4 focused; gate green

## PR #3546 — fix(ollama-compat): one decoder, one terminator, no dropped tail

- url: https://github.com/decolua/9router/pull/3546
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 7e5734ca4; ollama-compat NDJSON transform fix; 4/4 focused; gate green

## PR #3544 — fix(usage): stop dropping requests that share a millisecond

- url: https://github.com/decolua/9router/pull/3544
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 36aa66a83; usage dedupe narrowed to endpoint-less rows; 12/12 focused incl. 3 previously-known-fail db-concurrent tests now green; 3 baseline entries removed

## PR #3503 — fix(security): require auth for headroom, tunnel, oauth, and reset-password endpoints (GHSA-g6g7, GHSA-x5c9, GHSA-86m2, GHSA-8gmq, GHSA-6g2f)

- url: https://github.com/decolua/9router/pull/3503
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-28
- detail: PR supersedes 11/14 routes via fork's deny-by-default dashboardGuard (bb8680858, stronger than per-route requireAuth). Residual gap fixed: /api/headroom added to LOCAL_ONLY_PATHS, redundant /start /stop /proxy entries removed, 3 new guard tests. 45/45 guard tests, gate green 2019/85/2163, 0 unexpected

## PR #3501 — fix(security): require explicit JWT_SECRET env var, remove auto-generated fallback (GHSA-jphh)

- url: https://github.com/decolua/9router/pull/3501
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick b477cc59f (nitsuah, GHSA-jphh) + fork adaptation dropping dangling fs/path/DATA_DIR imports; JWT_SECRET now fail-fast at startup; behavior change documented (deployments relying on auto-generated secret must set JWT_SECRET)

## PR #3497 — fix(security): add SSRF protection via URL validation and DNS pinning (GHSA-8g4w, GHSA-6mwv, GHSA-cmhj, GHSA-qj3v)

- url: https://github.com/decolua/9router/pull/3497
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-28
- detail: Ported only the real gap: assertPublicUrl(issuerUrl) in fetchOidcDiscovery (single choke point). Skipped redundant per-route guards (fork validates at kiro service choke points) and inert open-sse DNS-pinning. 12/12 SSRF tests. Intranet IdP deployments now 400 (documented)

## PR #3502 — fix(security): require auth for providers and usage endpoints, mask API keys (GHSA-vjc7)

- url: https://github.com/decolua/9router/pull/3502
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: rejected
- closed: 2026-08-28
- detail: Fork supersedes via dashboardGuard deny-by-default + existing maskApiKey. BUT the analysis found a real fork bug (raw API key in byApiKey stats for 7d/30d/60d/all), fixed as c613f05cd; 4 new masked-key tests

## PR #3496 — fix(auth): prevent IP spoofing in brute-force protection (GHSA-32gc, GHSA-5mj8, GHSA-7cfm)

- url: https://github.com/decolua/9router/pull/3496
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: rejected
- closed: 2026-08-28
- detail: Fork already stronger via #3294 peer-token hardening (trustedPeer.js, custom-server.js, loginLimiter.js). PR would break 2 fork tests and its hunk 3 drops the x-9r-via-proxy check, reopening the spoofing class it cites

## PR #3495 — fix(sse): return Anthropic Message when Claude client hits forceStream provider

- url: https://github.com/decolua/9router/pull/3495
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 84c61d6148 (nitsuah); forced-SSE retry returns Anthropic Message to Claude clients, Codex path applied by hand around fork cacheRead lines; 12/12 focused; gate green

## PR #3543 — fix(oauth): stop leaking the callback server and its poll timer on failure

- url: https://github.com/decolua/9router/pull/3543
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick cde39d815 (Nguyen Thanh Dat); shared waitForCallbackParams + finally-close across antigravity/codex/gemini/iflow/oauth; 4/4 tests, AUDIT-018 green; xai.js has same pattern (noted follow-up)

## PR #3542 — fix(stream): record the turn when a client hangs up mid-stream (#3488)

- url: https://github.com/decolua/9router/pull/3542
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: 4 commits (2a0354c97..); TransformStream cancel() + finishStream once-guard records aborted turns; 8/8 tests

## PR #3541 — fix(tests): resolve security-audit sources from the repo, not the working dir

- url: https://github.com/decolua/9router/pull/3541
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 5f1e22103; 13 cwd-relative security-audit reads -> REPO_ROOT via import.meta.url; 21/21 from tests/ AND repo root

## PR #3540 — fix(grok-cli): forward reasoning.effort for grok-4.6 (#3514)

- url: https://github.com/decolua/9router/pull/3540
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 9805bed86; grok-cli effort allowlist grok-4.5->4.6; 25/25 executor tests

## PR #3539 — fix(providers): let self-hosted TTS/STT/embedding set their base URL (#3467)

- url: https://github.com/decolua/9router/pull/3539
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 86eb2a69d; declarative baseUrlField in registry for selfhosted TTS/STT/embedding; buildProviderSpecificData extracted; 12/12 tests

