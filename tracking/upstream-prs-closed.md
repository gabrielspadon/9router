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

## PR #3538 — fix(transport): send the translated body to the endpoint that speaks its format (#3418, #3439)

- url: https://github.com/decolua/9router/pull/3538
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 06ec1b07a; upstreamRoute.js resolves targetFormat+transport together; dead imports removed from chatCore; 12/12 upstream-route tests

## PR #3529 — feat(models): report token limits on combo entries in /v1/models (#3486)

- url: https://github.com/decolua/9router/pull/3529
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 0003a03c8 with fork adaptation (resolveTransport 3-arg with credentials); merge conflict with 3538 resolved taking superset; 12/12

## PR #3528 — fix(chat): treat a request without a stream key as non-streaming (#3492)

- url: https://github.com/decolua/9router/pull/3528
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick d8b51ef87; streamMode.js predicate, absent stream key = JSON (OpenAI default) except Gemini/Antigravity; 7/7

## PR #3537 — fix(quota): give the auto-refresh countdown a single timer owner (#3470)

- url: https://github.com/decolua/9router/pull/3537
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 591f432e3; createRefreshCountdownTimer extraction; 10/10

## PR #3534 — fix(headroom): use execFileSync to avoid shell string with spaces

- url: https://github.com/decolua/9router/pull/3534
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick a8ed492f2 + fork mock-signature fix c7ff0e7fe (upstream head fails its own suite); 5/5 detect tests

## PR #3531 — test(golden): make the OpenAI → Kiro golden reproducible

- url: https://github.com/decolua/9router/pull/3531
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 12ca5efa3; both Kiro uuids normalized to <UUID>, reproducibility guards, 9/9 twice

## PR #3530 — test(golden): stop the url/header golden from pinning the machine that recorded it

- url: https://github.com/decolua/9router/pull/3530
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-28
- detail: cherry-pick 924ef8e06 (Nguyen Thanh Dat); snapshot applies cleanly to fork (portability sanitizer + regenerated snapshot + new golden-snapshot-portability guard); 128/128 golden tests, gate green fails=66

## PR #3582 — docs: add 2 Vietnamese video guides by ptit9x

- url: https://github.com/decolua/9router/pull/3582
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 013728010; 2 Vietnamese video guide cards; README only

## PR #3500 — fix(security): require dual auth for database import/export (GHSA-qvfm)

- url: https://github.com/decolua/9router/pull/3500
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-28
- detail: PR reimplemented (upstream version had missing import + non-exported helpers): /api/settings/database now requires valid CLI token or JWT AND dashboard password for GET+POST; presence-only CLI-header bypass closed; hasValidCliToken exported from dashboardGuard; 3 new tests, 28/28 focused, gate green

## PR #3499 — fix(security): extend PROTECTED_SETTING_KEYS to prevent mass assignment (GHSA-vmjq)

- url: https://github.com/decolua/9router/pull/3499
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-28
- detail: Root-cause fix instead of the 23-key deny-list (blind port would break ~10 legit dashboard flows): settings PATCH on non-GET now requires loopback peer or valid CLI token/JWT even when requireLogin=false; 4 new dashboard-guard tests; gate green

## PR #3498 — fix(security): require CLI token auth for MCP plugin endpoints (GHSA-63p9, GHSA-fhh6)

- url: https://github.com/decolua/9router/pull/3498
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: rejected
- closed: 2026-08-28
- detail: Fork supersedes: /api/mcp/* in LOCAL_ONLY_PATHS behind deny-by-default middleware + peer-token hardening, strictly stronger than PR's per-route check; PR also imports non-exported symbol and would break local-browser MCP access

## PR #3527 — fix(mcp): release the bridge session when an SSE client disconnects

- url: https://github.com/decolua/9router/pull/3527
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 1fb2b8ac4 (usage stream listener cleanup; also covers PR 3526); request.signal + idempotent cleanup(); 4/4 leak tests

## PR #3526 — fix(usage): release the stats listeners when a dashboard tab disconnects

- url: https://github.com/decolua/9router/pull/3526
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: same upstream commit 1fb2b8ac4 as PR 3527 (PRs crossed upstream); merged via 3527 + alternate branch 101f4eb93 to keep history

## PR #3524 — fix(codex-settings): refuse to overwrite a config that could not be read

- url: https://github.com/decolua/9router/pull/3524
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick d755e9006 + fork commit a226e1285 extending readExistingConfig to droid/openclaw/opencode sibling clobber sites; 7/7 tests

## PR #3525 — fix(copilot-settings): keep the other providers when the config is unreadable

- url: https://github.com/decolua/9router/pull/3525
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-picks bb3f7e4eb + fd5c58d24 + fork adaptation cd2cac1e9 (JSONC-tolerant parser shared GET/POST); 8/8 tests; test-file conflict with 3524 resolved taking 3525 superset

## PR #3523 — fix(db): publish the sql.js database atomically

- url: https://github.com/decolua/9router/pull/3523
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: upstream 1fb2b8ac4? no - cherry-pick of sql.js atomic persist + fork commit 8e9cd5d87; temp+fsync+rename; 4/4 atomic-persist tests

## PR #3522 — fix(tunnel): draw the public subdomain from a CSPRNG

- url: https://github.com/decolua/9router/pull/3522
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 49a6d7fdf + e31dfd698 (brittle source-reading test dropped); crypto.randomInt in tunnel generateShortId; 4/4 behavioral tests

## PR #3521 — fix(stream): stop dropping generated images from OpenAI-format streams

- url: https://github.com/decolua/9router/pull/3521
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-28
- detail: cherry-pick a31a012fa resolved against fork's delta.reasoning clause (images added after reasoning); 4/4 tests, golden stream 7/7

## PR #3520 — fix(translator): close an OpenAI→Claude stream once, not once per finish chunk

- url: https://github.com/decolua/9router/pull/3520
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick fa9cf979d; claudeTerminalEmitted once-guard + toolArgBuffers clear; 4/4

## PR #3519 — fix(tunnel): accept either URL as proof the tunnel is up

- url: https://github.com/decolua/9router/pull/3519
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 47c7d6819; waitForHealth candidate URLs; 7/7

## PR #3518 — fix(auth): keep the real reason instead of the bare "Provider error"

- url: https://github.com/decolua/9router/pull/3518
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 4477ac5eb; describeProviderError in auth.js; 8/8

## PR #3517 — fix(proxy): never send loopback requests through the outbound proxy

- url: https://github.com/decolua/9router/pull/3517
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick ee678d8d9; isLoopbackTarget guards in proxyFetch env+connection resolvers; 18/18 tests. First worker attempt fetched a stale FETCH_HEAD (3519's commit); re-fetched the real PR head and validated before merge

## PR #3513 — fix(usage): record streaming requests that end before their flush

- url: https://github.com/decolua/9router/pull/3513
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: rejected
- closed: 2026-08-28
- detail: Superseded: fork commit 2a0354c97 (PR #3542, same upstream author) already records aborted streams via finishStream/cancel() with once-guard; upstream's withAbortRecording reworks the same flush block and would add a second parallel recording path. Residual gap noted: upstream-error mid-stream writes no partial detail row

## PR #3511 — fix(quota): stop the countdown from doubling after a visibility change

- url: https://github.com/decolua/9router/pull/3511
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: rejected
- closed: 2026-08-28
- detail: Superseded: fork commit 5848735f0 (PR #3537) already fixes #3470 with createRefreshTimers; fork variant strictly stronger (ref-stable refreshAll, unconditional unmount stop); test parity confirmed (10 cases incl. both upstream mutation probes)

## PR #3516 — fix(fallback): an expired per-model lock no longer masks an active account lock

- url: https://github.com/decolua/9router/pull/3516
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick b82719f34; isModelLockActive judges each key on expiry (NaN = no lock); 5/5 tests

## PR #3515 — fix(usage): make the observability env vars actually reach the enable check

- url: https://github.com/decolua/9router/pull/3515
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick c5dd7d6b5; resolveObservabilityEnabled precedence (unset env = no opinion); 10-case test + typo fix; gate now 64 known-fails

## PR #3512 — fix(providers): add a Base URL field for self-hosted TTS/STT connections

- url: https://github.com/decolua/9router/pull/3512
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-28
- detail: EditConnectionModal Base URL via fork's baseUrlField + mergeBaseUrl helper (upstream connectionBaseUrl naming dropped); TTS hint 8080->8880; 12/12 tests

## PR #3509 — fix(opencode): support muse models via responses api and strip max_tokens

- url: https://github.com/decolua/9router/pull/3509
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-28
- detail: cherry-picks c51cc78ee + d5b1829e9 + 366cf06a3: muse -> zen/v1/responses via upstreamRoute override, stripUnsupportedParams wired into opencode transformRequest, max_tokens/max_completion_tokens dropped for muse; cloudflare-ai flattenContent rule (accidentally dropped by upstream hunk) restored; 17/17 tests

## PR #3507 — feat(token-saver): add truthful aggregate observability

- url: https://github.com/decolua/9router/pull/3507
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-picks b53ba95f5 + 1eee7c563 (KunN-21); JSONL event store + stats API (LOCAL_ONLY) + dashboard tiles; chatCore signature merged with fork params; 47/47 tests

## PR #3506 — fix(claude): normalize trailing assistant prefill for Claude targets

- url: https://github.com/decolua/9router/pull/3506
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick d9c06d500; assistantPrefillPolicy concern wired into normalizeClaudePassthrough + prepareClaudeRequest (fork anchors matched spec); 10/10 tests; cache anchor re-lands after continuation turn

## PR #3504 — fix(opencode): forward reasoning_effort for OpenCode zen stealth models

- url: https://github.com/decolua/9router/pull/3504
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: 2 cherry-picks 9d568d5e5 + 6393c5654 (Shubham Mathur); opencode thinkingFormat enum + zen stealth caps; 7/7 + 28/28 adjacent

## PR #3487 — fix(models): expose combo aggregate token limits on /v1/models

- url: https://github.com/decolua/9router/pull/3487
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick b61a8c4ce (fredom); combo entries gain context_length (min member) + max_completion_tokens (max maxOutput); 60/60 combo tests

## PR #3482 — fix(capabilities): mark DeepSeek V4 Flash Vision as vision-capable

- url: https://github.com/decolua/9router/pull/3482
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick a22ce2163 (qingyong); vision capability + commandcode image pass-through; 2 conflicts resolved (fork stealth block + catalog order); formerly-KNOWN-BUG test now passes

## PR #3485 — fix(token-saver): secure management routes and honor PXPIPE opt-out

- url: https://github.com/decolua/9router/pull/3485
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-28
- detail: hand-port of upstream 85f2d4b: pxpipe branch honors tokenSaverEnabled, /api/pxpipe added to LOCAL_ONLY_PATHS (headroom entries redundant, fork prefix covers), pxpipe opt-out tests ported; 41/41

## PR #3483 — feat(opencode): support Ox Alpha image and effort

- url: https://github.com/decolua/9router/pull/3483
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-28
- detail: OX_ALPHA caps entries via fork's opencode format (upstream's new openai-low-high-max enum skipped as duplicate of PR 3504); suffix-strip ported; thinkingCanDisable claim kept as comment (unverified enum); 38/38

## PR #3494 — fix(token-saver): repair Headroom proxy UI and expose PXPIPE controls

- url: https://github.com/decolua/9router/pull/3494
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: upstream 8a4d6af07 + d9f3a6e06 (KunN-21); proxy allowlist/rewrites/generic-502/Bearer injection with fork loopback-credential exception preserved; token-saver-ui tests merged (3507 + PR assertions); pxpipe-install test-env adapted for mise layout; 73/73 focused

## PR #3493 — fix(headroom): harden compression and managed lifecycle

- url: https://github.com/decolua/9router/pull/3493
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-28
- detail: upstream KunN-21 commit adapted on branch upstream-pr-3493, merged ba7477d8e: pre-commit phantom-savings + structural-identity guards (replaces fork 3507 post-hoc warn, tiles now emit only on real commits), outbound key auth with scrubbing, PID-ownership + exactly-once fd, 500ms probe timeout, Claude direct path (pivot dropped, responses import kept), /api/headroom/status subsumed by fork prefix; detect test made platform-neutral (Linux); 135/135 focused, full gate green 2351/64/0 unexpected

## PR #3465 — fix(stream): fallback to next combo account on empty/null content responses

- url: https://github.com/decolua/9router/pull/3465
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: 3 upstream commits (ZQi) + fork adaptation 43e3266b2: empty-content 7-min lock via onEmptyStream, Responses body translation for Chat/Claude clients, data-only SSE; complementary to fork PR-3560 combo guard (no double-lock); 17/17 focused

## PR #3481 — fix(usage): preserve cache/reasoning breakdown, stop reasoning double-billing, refresh OpenAI/GPT prices

- url: https://github.com/decolua/9router/pull/3481
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: 5 commits incl. pricing e511efd2b; reasoning double-bill clamp, cache/reasoning detail passthrough, refreshed OpenAI/GPT rows, stream_options.include_usage; ADAPTATION: canonicalizeUsage reads Responses detail shapes; fork Claude rows now bill reasoning as delta (intended correction); 39/39

## PR #3478 — fix(translator): correctly route Claude thinking to Ollama `think` param

- url: https://github.com/decolua/9router/pull/3478
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick ccefa9caf (Shubham Mathur); ollama think param (bool|low|high|max), gpt-oss rows, manual-apply around fork's opencode/tokenrouter cases; 52/52 thinking tests

## PR #3476 — fix(commandcode): fail request on embedded 503 server_error so combo fallback triggers

- url: https://github.com/decolua/9router/pull/3476
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 34b5feef (Jefri Herdi Triyanto); NDJSON error-frame peek returns synthetic error so combo fallback fires; wrapper 200/SSE harmless on ok-path; 5/5

## PR #3471 — feat(quota): persist account and provider filter preferences in localStorage

- url: https://github.com/decolua/9router/pull/3471
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-28
- detail: cherry-pick 7f5ff5ac (wolf1999h); account/provider filter persistence + hydration-gated initial fetch; coexists with hasHydratedAutoRefresh; 13/13

## PR #3453 — Fly deploy

- url: https://github.com/decolua/9router/pull/3453
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: rejected
- closed: 2026-08-28
- detail: External contributor's personal deployment: full Telegram bot (~3.4k lines, new deps incl. canvas/chart.js) + Fly.io stack hardcoding their app name, plus a /api/telegram PUBLIC_API_PATHS trust-boundary bypass guarded only in-module. Not a runtime fix; would add a permanent audit surface. Zero upstream reviews

## PR #3451 — feat(opencode-go): add Ox Alpha free model

- url: https://github.com/decolua/9router/pull/3451
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: rejected
- closed: 2026-08-28
- detail: Superseded: ox-alpha-free already in fork via adapted #3483 (registry opencode-go.js:53 + OX_ALPHA_CAPABILITIES wired to all 4 aliases); fork catalog test pins exact arrays

## PR #3447 — feat(opencode): add Ox Alpha free model

- url: https://github.com/decolua/9router/pull/3447
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: rejected
- closed: 2026-08-28
- detail: Superseded: x-preview-f-free covered richer in fork (capabilities.js:121 incl. videoInput + live-probed thinkingFormat opencode; PR's unverified openai format would regress); fork keeps opencode registry dynamic-fetcher-only by design

## PR #3452 — fix(project-id): fail fast, skip needless refetch

- url: https://github.com/decolua/9router/pull/3452
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: cherry-pick 763cccd6 (S1NXIAN); done:true+empty project terminal, provider passthrough, refetch gated on stored projectId; 13/13 gemini-36 tests

## PR #3457 — feat(stream): emit SSE keepalive ping during upstream silence for Claude Code (#3409)

- url: https://github.com/decolua/9router/pull/3457
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-29
- detail: keepalive pings re-homed POST-transform (upstream injected pre-translator; translator would see pings); SSE_KEEPALIVE_MS via envMs allowZero, default 10s; cleanup on all terminal paths incl. TTFT fire; 6/6 keepalive+TTFT tests, spy proves translator input clean

## PR #3460 — feat: add Devin Cloud provider

- url: https://github.com/decolua/9router/pull/3460
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: 13 upstream commits (fadlee) + adaptation 965f0da4e: Devin Cloud provider (registry/executor/oauth/models/tests), alias+golden baselines regen, dead images config dropped, OAuthModal paste-gating fix (zed crash), server.js conflict kept fork OAUTH_TIMEOUT; 49 devin tests

## PR #3428 — fix: default stream to false when client omits stream field

- url: https://github.com/decolua/9router/pull/3428
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: rejected
- closed: 2026-08-29
- detail: Superseded by fork's merged PR 3528: streamMode.js:23 body?.stream===true with Gemini/Antigravity carve-outs, stronger test coverage (stream-mode-default-3492 + force-stream-config); upstream one-liner is a strict subset

## PR #3433 — fix(responses): preserve usage in completed events

- url: https://github.com/decolua/9router/pull/3433
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: upstream 2 commits; usage-only Chat SSE chunks captured, cached/reasoning mapped to Responses shape, completed deferred to flush; 5/5

## PR #3426 — fix(usage): show model and provider for single-item groups

- url: https://github.com/decolua/9router/pull/3426
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: cherry-pick 87e2a9c8d (dajinglingpake); single-item summary rows show model/provider; eslint clean

## PR #3429 — feat(models): add combo-only model exposure

- url: https://github.com/decolua/9router/pull/3429
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-29
- detail: lazy adaptation (upstream comboToEntry would drop fork enrichment): exposeComboOnly setting + post-loop early-return with owned_by=filter + profile toggle + 4 fork-mock tests

## PR #3423 — feat(open-sse): Revise Qwen3.8 pricing and add Meta Muse patterns and capabilities

- url: https://github.com/decolua/9router/pull/3423
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-29
- detail: qwen3.8 rows before *qwen*max*, step-3.7, canonical Qwen3.8 + qwen3-coder pricing, muse PATTERN_PRICING; upstream muse capability patterns skipped (fork live-verified opencode format wins); thinkingCanDisable:false added to muse-spark exact ids; 39/39

## PR #3445 — fix(opencode): route Muse models through Responses API

- url: https://github.com/decolua/9router/pull/3445
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-29
- detail: non-routing core ported in 3 commits (a9f2a35b8, 9f66475b6, 9ad2c0d30): incomplete-status preservation (finish_reason length/max_tokens), stream-arg respect + max_output_tokens precedence + tool_choice normalization, muse tool_choice demote + findModel suffix strip. Routing hunks NOT ported: fork's upstreamRoute regex (merged 3509) is sole owner. 8/8 new tests, gate green 2420/64/0 unexpected

## PR #3421 — feat(kimi): force streaming for the Kimi Code endpoint

- url: https://github.com/decolua/9router/pull/3421
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-29
- detail: forceStream:true on kimi + guarded negotiated-stream sync after stripContinuityFields (upstream unconditional sync would inject stream into gemini-cli/antigravity passthrough); baseline regen; 4/4 force-stream tests

## PR #3420 — fix(chat): sync negotiated stream flag into upstream body

- url: https://github.com/decolua/9router/pull/3420
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: upstream c73f33e1c (zmf); chatCore sync lines landed via 3421's guarded variant (superseding unconditional form); it.each sentBody assertion kept

## PR #3415 — feat(antigravity): add hot reload for pending quota countdown + bun lockfile support

- url: https://github.com/decolua/9router/pull/3415
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-29
- detail: hotreload route + HOT_RELOAD_CONFIG + UI (ConnectionRow/providers page/ProviderLimits) adapted to fork 3470-timer + filter-persistence state; bun gitignore; 40/40

## PR #3411 — fix(gemini): sanitize schema keywords in function responses to prevent 400

- url: https://github.com/decolua/9router/pull/3411
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: cherry-pick 69f9c55ea (AhooraZen) + Claude-path test; tryParseJSON sanitization covers all 3 call sites; sanitizes args too (upstream trade-off adopted)

## PR #3408 — fix(commandcode): strip thinking suffix from params.model

- url: https://github.com/decolua/9router/pull/3408
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: cherry-pick e58c050ec; params.model suffix strip; 15/15

## PR #3397 — fix(nvidia): drop EOL models, repoint DeepSeek V4 Flash at its live id

- url: https://github.com/decolua/9router/pull/3397
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: cherry-pick 16a4b0a4; NVIDIA EOL models dropped, deepseek-v4-flash -> deepseek-ai/deepseek-v4-flash-0731; baselines green

## PR #3388 — fix(usage): update dashboard stats in real time

- url: https://github.com/decolua/9router/pull/3388
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: cherry-pick dc1d8e2e0 (ndhao164); period-aware SSE + client full-replace + abort stale fetches + normalized token columns; fork abort-cleanup preserved; guard verified 401 unauthenticated; 3/3 e2e

## PR #3387 — fix(clinepass): unwrap { data, success } envelope in non-streaming responses

- url: https://github.com/decolua/9router/pull/3387
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: upstream 90a46b71c (linh.doan) + test cd4f5fc25; {data,success} envelope unwrap, inert for plain bodies; 3/3

## PR #3394 — feat(open-sse): parse RetryInfo, ErrorInfo, and resetsAtMs delay from…

- url: https://github.com/decolua/9router/pull/3394
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-29
- detail: cherry-pick a569328b3 (fasilu) + fixes: String(message) coercion before .includes (upstream TypeError bug), 30-day COOLDOWN.quota text rules dropped (uncapped path; ErrorInfo resetsAtMs is capped), gemini-cli retryAfter kept for combo; 10/10 new tests

## PR #3403 — fix: strict proxy propagation, client error fallback prevention, and stream gating

- url: https://github.com/decolua/9router/pull/3403
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-29
- detail: 8 upstream commits (minhnhat166) per-hunk: strictProxy propagation, context-length/400 pass rules (fork abuse rule kept), first-valid-event gate before fork onRequestSuccess, headroom CB merged into fork callCompress, nvidia additions on 3397, anthropic-beta rawHeader before fork strip, context_management strip; snapshots regenerated; golden 126/126

## PR #3386 — fix(codex): surface SSE context overflow as 413

- url: https://github.com/decolua/9router/pull/3386
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-29
- detail: upstream l.sousa commit; findSseContextOverflow + 413 + errorConfig {status:413,pass:true}; terminalStatusRule dropped (fork pass mechanism), combo-rotation test dropped (fork rotates on context errors); 21/21

## PR #3381 — fix(db): create credential store with owner-only permissions

- url: https://github.com/decolua/9router/pull/3381
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-29
- detail: upstream bac42ea4f (Elvis Hsu) + fork f1a3e02db: hardenPermissions dirs 0700/db 0600/backups 0600 + sqljs persist openSync(tmp,w,0o600) so rename keeps mode; 9/9

## PR #3380 — fix(auth): recognize the OIDC-only auth mode so SSO login can start

- url: https://github.com/decolua/9router/pull/3380
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: cherry-pick 17bd60ab (Alysson Souza e Silva); isOidcAuthMode accepts sso; 6/6

## PR #3373 — fix(responses): normalize custom tool names in non-streaming conversion

- url: https://github.com/decolua/9router/pull/3373
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: upstream 7b3d59c7f (krasumashi); customToolNames Set-normalization at consumer tops; Array/Set equivalence tests; 26/26

## PR #3369 — fix(translator): recover a tool result that arrived without an id

- url: https://github.com/decolua/9router/pull/3369
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: cherry-pick 420a5dd6 (Nguyen Thanh Dat); id-less tool_result paired to oldest unanswered call; 10/10

## PR #3368 — fix(cli): stop the hard-coded heap cap from overriding the operator

- url: https://github.com/decolua/9router/pull/3368
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: upstream d74eca222 (Nguyen Thanh Dat); CLI heap from NINEROUTER_MAX_OLD_SPACE_SIZE, NODE_OPTIONS stand-aside; 8/8

## PR #3367 — fix(usage): fetch and compute Cursor quota/usage

- url: https://github.com/decolua/9router/pull/3367
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: cherry-pick 0d0f48d2 (Villoh); Cursor Connect-RPC quota + baseline refresh (anthropic/nvidia pre-existing drift)

## PR #3366 — fix(antigravity): drop messages whose parts become empty after thought filtering

- url: https://github.com/decolua/9router/pull/3366
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: upstream 829f2a88 (Lucifer07); empty-parts filter after thought strip; 3/3

## PR #3364 — fix(model): route to custom node when prefix collides with built-in provider alias

- url: https://github.com/decolua/9router/pull/3364
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-29
- detail: cherry-pick b694e16d (ndiepdev); RESERVED_PROVIDER_PREFIXES guard removed, 4 node blocks unwrapped (fork multi-compatible block), cf test inverted to custom-node-first; 5/5

## PR #3363 — feat(providers): add Nous Research support

- url: https://github.com/decolua/9router/pull/3363
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: adapted
- closed: 2026-08-29
- detail: upstream (dungartoriaaa); Nous provider p123, thinkingFormat nous (nested enabled/effort), probe via fetchWithTimeout (fork gate), baselines re-snapshotted; 16/16

## PR #3376 — feat: Add custom JSON/JS provider adapters plugin system

- url: https://github.com/decolua/9router/pull/3376
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: fork's providerNodes system (types openai-compatible/anthropic-compatible/multi-compatible/custom-embedding, prefix-wins routing in src/sse/services/model.js post-3607) already implements the same job; PR adds a second parallel system colliding at migration 002 (fork has 002-seen-models at v2), SCHEMA_VERSION, and prefix levels. No fork demand for scripted unofficial endpoints. Analysis agent verdict: skip, medium confidence, 5/5 files checked against fork at 9e421206e

## PR #3361 — fix(codex): preserve typed Responses system prompts

- url: https://github.com/decolua/9router/pull/3361
- upstream-state: open (seeded 2026-08-28)
- local-status: in-progress (batch 18, branch upstream-pr-3361)
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 770ba4a12 (cherry-pick of upstream dae1a6cd, authorship preserved); typed Responses system injection + normalizeCodexMessageItems; tests/unit/codex-responses-system-injection.test.js; batch-18 gate 2580 pass/63 known fails

## PR #3359 — feat(antigravity): add hermes agent system prompt sanitization

- url: https://github.com/decolua/9router/pull/3359
- upstream-state: open (seeded 2026-08-28)
- local-status: in-progress (batch 18, branch upstream-pr-3359)
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 2a73a071a (upstream 1a7f88d98/a0ab2f51a/8fdc51fea, authorship Travis Groth); sanitizeAntigravitySystemPrompt at 3 sites + executor safeguard; tests/unit/hermes-cloaking.test.js

## PR #3357 — fix(codebuddy-intl): preserve caller system prompts

- url: https://github.com/decolua/9router/pull/3357
- upstream-state: open (seeded 2026-08-28)
- local-status: in-progress (batch 18, branch upstream-pr-3357)
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge a02416762 (upstream a4f29f45); caller system/developer prompts preserved after CodeBuddy identity; tests/unit/codebuddy-intl-system-prompt-3344.test.js

## PR #3352 — feat(backoff): make 429 cooldown schedule configurable

- url: https://github.com/decolua/9router/pull/3352
- upstream-state: open (seeded 2026-08-28)
- local-status: in-progress (batch 18, branch upstream-pr-3352)
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge a4fe5d118 (upstream dd6ba369 + fork comment fix 88d669128); BACKOFF_BASE_MS/MAX_MS/MAX_LEVEL with parsePositiveInteger validation, defaults unchanged; resetsAtMs path untouched; tests/unit/rate-limit-backoff-config.test.js

## PR #3349 — docs(i18n): sync Indonesian README with English source

- url: https://github.com/decolua/9router/pull/3349
- upstream-state: open (seeded 2026-08-28)
- local-status: in-progress (batch 18, branch upstream-pr-3349)
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 73078e6b2 (upstream 15d9a9b37/cb18da439, authorship Alfareza); docs-only i18n/README.id-ID.md sync, image paths verified

## PR #3350 — Fix/kiro reasoning text content fields

- url: https://github.com/decolua/9router/pull/3350
- upstream-state: open (seeded 2026-08-28)
- local-status: in-progress (batch 18, branch upstream-pr-3350)
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge df7bbf800+ (upstream 195505255 partial, commits 3ccf3a873/003fa6f0c/9d7bdfc2c); kiro reasoning text field in 3 frame sites, mitm lock-dir mkdir, getTailscaledBin, oauth 502 no-token guard. GapGPT provider addition skipped (deferred, large port)

## PR #3348 — fix(stream): recover partial usage when a client disconnects before completion

- url: https://github.com/decolua/9router/pull/3348
- upstream-state: open (seeded 2026-08-28)
- local-status: in-progress (batch 18, branch upstream-pr-3348)
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge df7bbf800 (ad283c428); error-path finalization only, routed through fork's single finishStream guard, no streamState double-record; tests/unit/streaming-interrupted-detail.test.js (7)

## PR #3347 — Improvements: opencode/Hermes QOL - usable /v1/models listing, bare-name resolution, usage pipeline fixes

- url: https://github.com/decolua/9router/pull/3347
- upstream-state: open (seeded 2026-08-28)
- local-status: in-progress (batch 18, branch upstream-pr-3347)
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge b3472d12c (7cf0ef406+); bare-name model resolution (fork freeModelsRepo backing) + canonicalEchoModel echo + requestedModel attribution via buildRecentRequestRow; PR route.js/usageRepo-backfill/UI-toggle hunks skipped (superseded by fork freeModelSync/3488)

## PR #3346 — fix(kiro/cloudflare): dedup catalogs, request-scoped 400s, live model import + usage

- url: https://github.com/decolua/9router/pull/3346
- upstream-state: open (seeded 2026-08-28)
- local-status: in-progress (batch 18, branch upstream-pr-3346)
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 7e935d1ac (cac646095/e9665a558/18db502a6); targeted subset: invalid-model-id pass rule, Cloudflare + OpenCode-Go usage handlers, Ark GLM maxOutputCap, combo prefill tool-results-to-user. Skipped: commandcode migration (fork runs legacy stack), models-dev stack, requestLogger masking (fork keeps full tokens deliberately), upstream glm-5.2 caps

## PR #3301 — fix(chat): send JSON content-type when client omits the stream field

- url: https://github.com/decolua/9router/pull/3301
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork streamMode.js clientRequestedStreaming returns body?.stream === true (default false); chatCore.js:195-197 uses it

## PR #3175 — fix(stream): finalize interrupted streaming request details

- url: https://github.com/decolua/9router/pull/3175
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork chatCore.js:621-631 abandonStreamingDetail + streamingHandler.js:339 finalize interrupted streams

## PR #3051 — fix(stream): an empty stream returns HTTP 200 with an empty body

- url: https://github.com/decolua/9router/pull/3051
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork first-chunk gate blocks empty streams with 502 before headers (streamingHandler.js:103-120)

## PR #2713 — Fix OpenAI Responses stream reconstruction

- url: https://github.com/decolua/9router/pull/2713
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork sseToJsonHandler.js:416-431 already maps incomplete/max_output_tokens to length/stop; streamToJsonConverter.js:36-41 preserves incomplete_details

## PR #2697 — fix(capabilities): support bare Kimi K3 upstream id

- url: https://github.com/decolua/9router/pull/2697
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork capabilities.js:329 has *kimi*k3* pattern and line 131 the bare k3 entry, before generic kimi

## PR #2541 — fix: allow application/x-ndjson streaming from ollama-local (closes #2386)

- url: https://github.com/decolua/9router/pull/2541
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork streamingHandler.js:60 whitelists application/x-ndjson (and stream+json) in content-type gate

## PR #2525 — fix(minimax): OpenAI transport passthrough, reasoning_split, and client stream sanitization

- url: https://github.com/decolua/9router/pull/2525
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork upstreamRoute.js modelTargetFormat/supportedFormats guard supersedes the transport-precedence change; reasoning_split detail remains, minor

## PR #2462 — fix(antigravity): retry empty streams, surface aborted turns, finalize truncated Claude streams

- url: https://github.com/decolua/9router/pull/2462
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Redundant with PR 3214: both add the same new emptyStreamGuard.js + antigravity empty-retry; 3214 is the larger superset

## PR #2315 — fix(kiro): convert Claude model ID dots to dashes before upstream dispatch

- url: https://github.com/decolua/9router/pull/2315
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Redundant with PR 2904: same toKiroModelId idea; 2904 is the refined letter-dot-digit-only variant

## PR #2146 — fix(claude): translate non-streaming OpenAI responses back to Anthropic format

- url: https://github.com/decolua/9router/pull/2146
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork nonStreamingHandler.js:257-259 already converts OpenAI body to openAICompletionToClaudeMessage for CLAUDE clients

## PR #2081 — fix(chat): keep streaming for forceStream providers when client requests JSON (#2031)

- url: https://github.com/decolua/9router/pull/2081
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork streamMode.js + stream_options (default.js:74-77) + handleForcedSSEToJson (chatCore.js:901) implement the same contract

## PR #1843 — fix(commandcode): force params.stream=true for non-streaming requests

- url: https://github.com/decolua/9router/pull/1843
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork openai-to-commandcode.js:146 sets params.stream; executor sets body.stream=true; registry commandcode.js:24 forceStream:true

## PR #1824 — fix: stabilize MiMo Free Claude streams

- url: https://github.com/decolua/9router/pull/1824
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork restructured MiMo into registry mmf.js + executors/mimo-free.js; PR's providerModels.mimo-free section no longer exists

## PR #1568 — fix(sse): prevent false stall aborts on large-context reasoning streams

- url: https://github.com/decolua/9router/pull/1568
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork runtimeConfig.js:42-69 has envMs + STREAM_STALL_TIMEOUT_MS/STREAM_FIRST_CHUNK_TIMEOUT_MS with generous defaults

## PR #1418 — fix(codex): abort stalled initial upstream responses

- url: https://github.com/decolua/9router/pull/1418
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork pipeWithDisconnect has TTFT (30s) + first-chunk + stall watchdogs (streamHandler.js:220-241); codex-specific 7s deadline redundant

## PR #1401 — Fix /v1/messages non-streaming JSON mode

- url: https://github.com/decolua/9router/pull/1401
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork streamMode.js + Accept-header logic (chatCore.js:214-227) supersede resolveChatStreamMode

## PR #1272 — fix(chatCore): default stream to false per OpenAI spec (#1260)

- url: https://github.com/decolua/9router/pull/1272
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork streamMode.js clientRequestedStreaming: body?.stream === true (default false), same fix

## PR #1084 — fix(antigravity): drop literal <think>/</think> markers from Claude→OpenAI stream

- url: https://github.com/decolua/9router/pull/1084
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Identical 2-line removal to PR 980's core change; keep 980 (adds a test)

## PR #815 — feat: add Kiro MITM translation with AWS EventStream binary encoding

- url: https://github.com/decolua/9router/pull/815
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork kiro.js:222 implements CodeWhisperer AWS EventStream binary decoding natively in the executor

## PR #360 — Updated non-streaming responses for OpenAI compatible clients having agentic use-cases

- url: https://github.com/decolua/9router/pull/360
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork streamMode.js + streamPolicy machinery + handleForcedSSEToJson fully supersede this stream-defaulting rework

## PR #345 — fix: preserve tool_calls during SSE-to-JSON reassembly

- url: https://github.com/decolua/9router/pull/345
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork sseToJsonHandler.js:216-217 accumulates delta.tool_calls into the reassembled response

## PR #286 — Fix: SSE data: [DONE] sentinel for non-streaming requests (complements PR #285)

- url: https://github.com/decolua/9router/pull/286
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork nonStreamingHandler returns pure application/json (line 552), no SSE framing on the non-streaming path at all

## PR #2960 — docs(i18n): update RTK Token Saver features and 2026 free providers in README.ja-JP.md

- url: https://github.com/decolua/9router/pull/2960
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Docs-only i18n README refresh plus a token-count test; no runtime value for fork.

## PR #2390 — feat(api-keys): per-key model allowlist + token/cost limits

- url: https://github.com/decolua/9router/pull/2390
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Per-key allowlist+limits redundant with open PR 3205 (rate limits, budget, expiry superset) and 448.

## PR #2331 — fix(providers): allow multiple API-key connections per compatible node

- url: https://github.com/decolua/9router/pull/2331
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork src/app/api/providers/route.js:129 'Compatible LLM nodes support multiple API-key connections (key pool)' already implements this.

## PR #2171 — feat(providers): add Featherless free tier provider

- url: https://github.com/decolua/9router/pull/2171
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork already has open-sse/providers/registry/featherless.js (index.js:33 import p31) with a newer model list.

## PR #2152 — update add multiple apikey at providers

- url: https://github.com/decolua/9router/pull/2152
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Same restriction removal as 2331; fork providers/route.js:129 already supports multi-connection key pools.

## PR #1774 — fix: remove single-connection restriction for compatible provider nodes

- url: https://github.com/decolua/9router/pull/1774
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Single-connection restriction already removed in fork (providers/route.js:129 key-pool comment).

## PR #1670 — feat(provider): add Command Code CLI provider

- url: https://github.com/decolua/9router/pull/1670
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork already has open-sse/executors/commandcode.js + registry/commandcode.js (index.js:24) covering Command Code provider.

## PR #1655 — feat: update antigravity 3.5 flash models

- url: https://github.com/decolua/9router/pull/1655
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork src/mitm/config.js:57,71 already maps gemini-3.5-flash-extra-low synonyms; cli alias present too.

## PR #1338 — Fix provider client priority sorting

- url: https://github.com/decolua/9router/pull/1338
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork client/route.js sortConnections (lines 74-79) already sorts by priority then provider.

## PR #960 — Polish provider breadcrumbs and custom provider actions

- url: https://github.com/decolua/9router/pull/960
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Cosmetic breadcrumb/Header churn on fork-modified page.js/Header.js; no functional gain.

## PR #891 — feat(cx): add GPT-5.5 Pro and GPT-5.4 Pro models with pricing

- url: https://github.com/decolua/9router/pull/891
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork open-sse/providers/pricing.js:334 gpt-5.4-pro and :348 gpt-5.5-pro already present.

## PR #665 — fix: add API key support for OpenCode Go provider (closes #662)

- url: https://github.com/decolua/9router/pull/665
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork validate route.js:417 already has case 'opencode-go' API-key test; opencode free is noAuth (registry opencode.js:14).

## PR #657 — fix: strip provider prefixes from remote /models IDs to avoid double-prefixing (closes #449)

- url: https://github.com/decolua/9router/pull/657
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork v1/models route.js:477-487 already strips outputAlias/staticAlias/providerId prefixes from remote IDs.

## PR #518 — fix: fetch API Key Compatible provider models for /v1/models endpoint

- url: https://github.com/decolua/9router/pull/518
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork v1/models route.js:175 fetchCompatibleModelIds already feeds compatible-provider models into /v1/models.

## PR #224 — feat(api-keys): add per-API-key model allowlist filtering

- url: https://github.com/decolua/9router/pull/224
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Per-key allowlist superseded within the open set by PR 448/3205 which cover model allowlist plus restrictions.

## PR #189 — Implement per-provider proxy configuration

- url: https://github.com/decolua/9router/pull/189
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork base.js uses proxyAwareFetch (proxyFetch.js) and per-connection proxy pools exist (page.js bulkProxyPoolId, getProxyPools in models/index.js).

## PR #3345 — fix(models): respect UI configured models and prevent live catalog/upstream override

- url: https://github.com/decolua/9router/pull/3345
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork gates live catalog on explicit UI models: enabledModels short-circuit (v1/models/route.js:436), liveResolver skip when hasExplicitEnabledModels (:454), customModels whitelist authoritative (:537).

## PR #3337 — feat(opencode-go): show subscription quota on the dashboard

- url: https://github.com/decolua/9router/pull/3337
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork has full handler getOpencodeGoUsage returning plan:'OpenCode Go' + rolling/weekly/monthly quotas (open-sse/services/usage/misc.js:321-390) wired in usage.js:61; registry features usage+usageApikey (opencode-go.js:124-126).

## PR #3077 — feat(branding): real OpenDesign logo + per-tool integration guide (5 langs)

- url: https://github.com/decolua/9router/pull/3077
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Docs-only marketing: OpenDesign logo + 18-file 5-language integration guides in gitbook; no runtime value to fork.

## PR #3065 — fix(headroom): rewrite dashboard asset/link URLs behind proxy prefix

- url: https://github.com/decolua/9router/pull/3065
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork rewriteHeadroomHtml already rewrites src/href/action + fetch() generically against ALLOWED_PREFIXES incl dashboard/assets/stats (headroom/proxy/[...path]/route.js:20-33,49-74).

## PR #2777 — feat(dashboard): add bulk enable/disable for provider connections

- url: https://github.com/decolua/9router/pull/2777
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork already has handleEnableAll/handleDisableAll + toolbar buttons in providers/[id]/page.js:271,292,1816-1821.

## PR #2672 — feat(xai): track OAuth quotas in dashboard

- url: https://github.com/decolua/9router/pull/2672
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork integrated grok-cli usage: usage.js:57 dispatch, services/usage/grok-cli.js + grokCliQuotaFrame.js, SuperGrok weekly gRPC (f17a68ae, d0751bce), grok-cli-usage.test.js.

## PR #2570 — feat(ui): show Codex plan labels in provider and quota views

- url: https://github.com/decolua/9router/pull/2570
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Redundant with open PR #3210, which implements the same Codex plan badge (stored chatgptPlanType plus live usage plan) with more coverage.

## PR #2562 — feat(token-saver): add aggregate Token Saver dashboard

- url: https://github.com/decolua/9router/pull/2562
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork merged token-saver truthful observability (553e62ff, PR #3507): TokenSaverClient, api/token-saver/stats, lib/tokenSaver/events.js, 5 test files.

## PR #2465 — feat(pxpipe): PXPIPE token saver — multimodal prompt compression (in-process)

- url: https://github.com/decolua/9router/pull/2465
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork has pxpipe stack: dashboard/pxpipe page+PxpipeClient, api/pxpipe (health/install/logs), open-sse/rtk/pxpipe.js, pxpipe.test.js; chatCore split into fork structure means remaining hunks are integration residue.

## PR #2402 — fix(build): isolate Windows HOME/AppData during next build

- url: https://github.com/decolua/9router/pull/2402
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork build-cli.js:150-181 already isolates HOME/USERPROFILE/APPDATA/LOCALAPPDATA to buildHomeDir during npm run build.

## PR #2127 — Update provider icons

- url: https://github.com/decolua/9router/pull/2127
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: All six PNGs already in public/providers: cerebras, chutes, fireworks, hyperbolic, siliconflow, vercel-ai-gateway.

## PR #1784 — fix: resolve ReferenceError for allProviders in ModelSelectModal

- url: https://github.com/decolua/9router/pull/1784
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork ModelSelectModal already defines allProviders memo (:159) with complete dependency array (:397) plus providerNodes/customModels fetching; ReferenceError path gone.

## PR #1760 — fix(siliconflow): update baseUrl .cn -> .com + sync full model list from API

- url: https://github.com/decolua/9router/pull/1760
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork siliconflow registry already uses api.siliconflow.com for baseUrl and validateUrl (registry/siliconflow.js:17-18).

## PR #1685 — fix: resolve nested standalone build path

- url: https://github.com/decolua/9router/pull/1685
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork build-cli.js:94-96 detects and resolves nested standalone output (pkgName/server.js).

## PR #1561 — feat(dashboard): show which API key was used per recent request (#1258)

- url: https://github.com/decolua/9router/pull/1561
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork has API_KEY_COLUMNS + 'Usage by API Key' table (UsageStats.js:176-182,204) and byApiKey aggregation with keyName in usageRepo.js:91-93,287.

## PR #1508 — feat: add Basic Chat page for testing models

- url: https://github.com/decolua/9router/pull/1508
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork already ships basic-chat page (dashboard/basic-chat/BasicChatPageClient.js + api/dashboard/models route); fork deliberately hides the sidebar entry.

## PR #1504 — fix: keep dashboard sidebar visible on desktop

- url: https://github.com/decolua/9router/pull/1504
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork DashboardLayout keeps desktop sidebar via 'hidden lg:flex' wrapper (DashboardLayout.js:80) with mobile overlay.

## PR #1391 — Fix sql.js WASM in standalone builds

- url: https://github.com/decolua/9router/pull/1391
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork build-cli.js:224-251 ensures sql.js bundled in standalone + next.config.mjs serverExternalPackages includes sql.js.

## PR #501 — fix: ensure dashboard binds to provided host (Next.js --hostname) (cl…

- url: https://github.com/decolua/9router/pull/501
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork replaced 'next start' with custom-server.js entrypoint (package.json:12 'node custom-server.js --port 20127'), so next-start --hostname edits no longer apply to fork's serving path.

## PR #400 — feat: add test suite (96 tests) and GitHub Actions CI workflow

- url: https://github.com/decolua/9router/pull/400
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Fork already carries 259 unit tests and its own workflows (docker-publish, gitbook-pages); upstream's 96-test suite and CI duplicate existing infra.

## PR #3315 — fix(codex): retry phản hồi quá tải giả HTTP 200

- url: https://github.com/decolua/9router/pull/3315
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork executors/codex.js:18,335-371 already retries SSE overloaded fake-200 errors

## PR #3238 — fix(kiro): comment out systemPrompt field causing REQUEST_BODY_INVALID

- url: https://github.com/decolua/9router/pull/3238
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: fork commit 5041494e1 delivers system prompt natively; PR reverses that behavior

## PR #3217 — fix(translator): preserve Responses prompt cache key

- url: https://github.com/decolua/9router/pull/3217
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork executors/codex.js:50 preserves prompt_cache_key in passthrough field list

## PR #3213 — fix(auto-ping): select Codex model from live catalog

- url: https://github.com/decolua/9router/pull/3213
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork quotaAutoPing service + open-sse/services/usage/codex.js live catalog probes present

## PR #3167 — fix(openai): normalize overlong tool call IDs

- url: https://github.com/decolua/9router/pull/3167
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: superseded by open PR 3174 (same author, superset: adds base.js/chatCore + luna routing)

## PR #3089 — fix(gemini): strip stray value key at schema nodes

- url: https://github.com/decolua/9router/pull/3089
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork gemini schema cleaning removes stray keys (removeUnsupportedKeywords/cleanupRequired present)

## PR #3082 — fix(gemini): walk schema nodes only in cleanJSONSchemaForAntigravity

- url: https://github.com/decolua/9router/pull/3082
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork formats/gemini.js cleanJSONSchemaForAntigravity with removeUnsupportedKeywords/cleanupRequired

## PR #3054 — Akar masalah: saat request di-route ke openai/gpt-5.1, body body clie…

- url: https://github.com/decolua/9router/pull/3054
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork paramSupport.js has cloudflare-ai flatten + Ark GLM clamp (:115); stripUnsupportedParams 5 hits

## PR #3039 — fix(kiro): canonicalize unsupported tool schemas

- url: https://github.com/decolua/9router/pull/3039
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork kiroConversation.js:383 canonicalizeKiroConversation + unevaluatedProperties stripping

## PR #3038 — fix(kiro): support API-key model discovery

- url: https://github.com/decolua/9router/pull/3038
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork commit 16cb40fda routes kiro API keys correctly + kiroModels discovery

## PR #2923 — fix(codex): normalize replayed call item IDs

- url: https://github.com/decolua/9router/pull/2923
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork executors/codex.js:35 SERVER_ID_PATTERN normalizes server-generated item ids

## PR #2891 — fix(kiro): restore v0.5.20 payload and enable all effort levels

- url: https://github.com/decolua/9router/pull/2891
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork claude-to-kiro.js:25 resolveKiroThinkingBudget + thinking prefixes restored

## PR #2849 — fix(claude): align CLI fingerprint and session headers

- url: https://github.com/decolua/9router/pull/2849
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork utils/claudeCloaking.js:5 sdk-cli + X-Claude-Code-Session-Id alignment :131-135

## PR #2800 — fix(thinking): keep compatible Qwen requests OpenAI-shaped

- url: https://github.com/decolua/9router/pull/2800
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork thinkingUnified keeps Qwen-compatible requests OpenAI-shaped (qwen handling present)

## PR #2796 — fix(codex): normalize additional_tools passthrough items

- url: https://github.com/decolua/9router/pull/2796
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork already normalizes additional_tools (3 hits in handlers)

## PR #2787 — fix(codex): preserve GPT-5.6 max reasoning

- url: https://github.com/decolua/9router/pull/2787
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork thinkingLevels.js gpt-5.6 entries preserve max reasoning

## PR #2761 — fix(github): route Claude models to Copilot's native format via chatCore

- url: https://github.com/decolua/9router/pull/2761
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork executors/github.js:126 routes Claude to Copilot Anthropic-native /v1/messages shim

## PR #2760 — fix(capabilities): correct thinking format and limits for the 4.6+ Claude generation

- url: https://github.com/decolua/9router/pull/2760
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork capabilities.js has 4.6+ entries incl. opus-5/1M adaptive

## PR #2753 — feat(antigravity): add gemini-3.6 (low/medium/high) models

- url: https://github.com/decolua/9router/pull/2753
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork registry/antigravity.js:48-53 has gemini-3.6 and 3.7 tiered low/medium/high

## PR #2747 — fix(responses): keep translated output indexes unique

- url: https://github.com/decolua/9router/pull/2747
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork openai-responses response side already manages output_index uniqueness

## PR #2731 — refactor(kiro): keep terminal integrity transport-only

- url: https://github.com/decolua/9router/pull/2731
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork executors/kiro.js has terminal_provenance/integrity buffer transport rework

## PR #2698 — fix: move headroom before translation to cover all output formats (#2…

- url: https://github.com/decolua/9router/pull/2698
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork chatCore.js:488 headroomDiagnostics; headroom ordering already in pipeline

## PR #2688 — fix(kiro): retry malformed tool_call wrappers once

- url: https://github.com/decolua/9router/pull/2688
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork executors/kiro.js:42 repair instruction for malformed tool_call wrappers

## PR #2681 — fix(kiro): validate completed nested tool_call payloads

- url: https://github.com/decolua/9router/pull/2681
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork executors/kiro.js stream rewrite validates toolUseEvent fragments (:826-850)

## PR #2657 — fix(rtk): preserve non-message Responses items

- url: https://github.com/decolua/9router/pull/2657
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork rtk/systemInject.js:45-79 handles Responses input[] items and instructions

## PR #2652 — fix(github): use adaptive thinking for Claude Fable 5

- url: https://github.com/decolua/9router/pull/2652
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork capabilities.js covers Fable/adaptive-thinking entries (getCapabilitiesForModel 26 hits)

## PR #2618 — fix(kiro): preserve credit metering cost

- url: https://github.com/decolua/9router/pull/2618
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork executors/kiro.js:883 carries kiro_credit_unit metering into usage

## PR #2523 — fix(codex): preserve GPT-5.6 effort semantics on Codex wire

- url: https://github.com/decolua/9router/pull/2523
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork codex.js:534-542 + thinkingLevels encode GPT-5.6 effort semantics

## PR #2508 — fix(codex): inject token saver prompts as instructions

- url: https://github.com/decolua/9router/pull/2508
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork rtk/systemInject.js injects via top-level instructions + input[]; tokenSaver wired chatCore.js:362

## PR #2452 — fix(codex): preserve GPT-5.6 max reasoning

- url: https://github.com/decolua/9router/pull/2452
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork providers/thinkingLevels.js + CODEX_GPT_56_DEFAULT_CAPS preserve GPT-5.6 max reasoning

## PR #2404 — feat(ponytail): add command bridge and shared bypass responses

- url: https://github.com/decolua/9router/pull/2404
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork has rtk/ponytailPrompt.js + bypassHandler wired at chatCore.js:30,158

## PR #2369 — fix(kiro): nest thinking/output_config/max_tokens in additionalModelRequestFields

- url: https://github.com/decolua/9router/pull/2369
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork already nests additionalModelRequestFields (7 hits incl. kiro executors)

## PR #2355 — fix(kiro): support IDC/Org tokens when the Q Developer profile region differs from the Identity Center region

- url: https://github.com/decolua/9router/pull/2355
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork executors/kiro.js region handling covers IDC/Org profile-region mismatch

## PR #2322 — feat(models): add claude-sonnet-5 to Claude Code and Antigravity registries

- url: https://github.com/decolua/9router/pull/2322
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork commit a5363b83b added Claude Sonnet 5 model support (#2264)

## PR #2317 — fix(antigravity): strip multipleOf from Gemini tool declaration schemas

- url: https://github.com/decolua/9router/pull/2317
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork formats/gemini.js:10 strips multipleOf in schema cleaning

## PR #2314 — fix(kiro): preserve IDC region across ARN discovery

- url: https://github.com/decolua/9router/pull/2314
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork src/lib/oauth/providerHelpers.js carries ARN/region handling

## PR #2312 — fix(translator): preserve Z.ai reasoning effort

- url: https://github.com/decolua/9router/pull/2312
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork thinkingUnified already preserves Z.ai reasoning_effort mapping

## PR #2301 — fix: Kiro non-us-east-1 (IDC/Organization) support + token import — centralized region topology

- url: https://github.com/decolua/9router/pull/2301
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork executors/kiro.js:283-294 handles external_idp/idc auth + regionalize; kiro gateway topology present

## PR #2295 — fix(claude): return summarized adaptive thinking

- url: https://github.com/decolua/9router/pull/2295
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork thinkingUnified has adaptive handling + redact-thinking beta (5 hits)

## PR #2237 — fix(translator): salvage orphaned tool results across request formats

- url: https://github.com/decolua/9router/pull/2237
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork merged #3369 recover tool result without id (commit 39f94488a) + toolDeduper

## PR #2154 — fix(stt): forward all client form fields to OpenAI/Groq STT

- url: https://github.com/decolua/9router/pull/2154
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork sttCore.js:5 builds auth from sttConfig; voices route present

## PR #2009 — fix(kiro): support IAM Identity Center accounts outside us-east-1

- url: https://github.com/decolua/9router/pull/2009
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork executors/kiro.js:292-294 regionalizes amazonaws URLs by token region

## PR #2001 — fix(antigravity): sanitize thinking level and map Claude models under antigravity to gemini-level

- url: https://github.com/decolua/9router/pull/2001
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork thinkingUnified sanitizes levels; antigravity registry maps tiers via upstreamModelId

## PR #1999 — Remove deprecated Gemini CLI provider

- url: https://github.com/decolua/9router/pull/1999
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: fork deliberately retains Gemini CLI (registry/gemini-cli.js exists); deletion conflicts with fork

## PR #1875 — fix(kiro): inject agentic chunked-write prompt only on first turn (not every turn)

- url: https://github.com/decolua/9router/pull/1875
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork openai-to-kiro.js:15 wires KIRO_AGENTIC_SYSTEM_PROMPT (first-turn gating present)

## PR #1828 — fix: rename max_tokens to max_completion_tokens for newer OpenAI models

- url: https://github.com/decolua/9router/pull/1828
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: redundant with open PR 3167/3174 (same max_completion_tokens rename, superset)

## PR #1823 — fix: refresh Kiro model discovery on invalid bearer token

- url: https://github.com/decolua/9router/pull/1823
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork services/kiroModels.js already refreshes discovery on auth failure

## PR #1813 — Fix Xiaomi Token Plan Claude-native routing

- url: https://github.com/decolua/9router/pull/1813
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork xiaomi-tokenplan executor is Claude-native (upstreamModelId/mimo routing present)

## PR #1797 — fix(openai): fallback to responses for gpt-5/codex

- url: https://github.com/decolua/9router/pull/1797
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork default.js buildUrl uses runtimeTransport sourceFormat-matched endpoints; responses fallback covered

## PR #1701 — fix: forward connection-level proxy to Gemini/OpenAI embedding requests

- url: https://github.com/decolua/9router/pull/1701
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork embeddingsCore already uses connectionProxyUrl/connectionNoProxy (22/19 hits)

## PR #1643 — feat: add Claude-native Xiaomi TokenPlan model alias

- url: https://github.com/decolua/9router/pull/1643
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork xiaomi executor + modelTargetFormat (3/3 tokens) already Claude-native

## PR #1573 — fix(kiro): emit valid concatenable tool_calls.arguments deltas

- url: https://github.com/decolua/9router/pull/1573
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork executors/kiro.js:687 appendToolInput buffers object-form input, emits final once

## PR #1559 — feat: add xiaomi-tokenplan support Anthropic (Claude-format)

- url: https://github.com/decolua/9router/pull/1559
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork has dedicated open-sse/executors/xiaomi-tokenplan.js + providers entries; evolved beyond PR

## PR #1505 — fix: dedupe Anthropic version headers

- url: https://github.com/decolua/9router/pull/1505
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork executors/base.js:101 sets anthropic-version only when absent = dedupe

## PR #1500 — fix: strip Claude context management for compatible providers

- url: https://github.com/decolua/9router/pull/1500
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork handles context_management (2 hits, claude passthrough path); strip-for-compat covered

## PR #1488 — fix responses max_tokens mapping

- url: https://github.com/decolua/9router/pull/1488
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork openai-responses.js:317-319 max_output_tokens > max_completion_tokens > max_tokens precedence

## PR #1460 — Preserve reasoning effort for Codex translations

- url: https://github.com/decolua/9router/pull/1460
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork claude-to-openai.js:83 already forwards reasoning_effort; openai-responses too

## PR #1455 — fix: add Codex subagent description

- url: https://github.com/decolua/9router/pull/1455
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork codex-settings route carries the subagent description (effectiveSubagentModel block :145)

## PR #1425 — Default Codex reasoning to medium

- url: https://github.com/decolua/9router/pull/1425
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork executors/codex.js:534 reasoning effort priority list ends in default (medium)

## PR #1416 — fix: add Codex subagent role description

- url: https://github.com/decolua/9router/pull/1416
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork codex-settings/route.js:145 effectiveSubagentModel already present

## PR #1415 — i18n: add zh-CN password hint translations

- url: https://github.com/decolua/9router/pull/1415
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: zh-CN.json already contains the password hint (rg 密码 found)

## PR #1402 — Route Codex auto-review to Codex provider

- url: https://github.com/decolua/9router/pull/1402
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork capabilities.js:162 gpt-5.6-luna-review + providerModels.js:6 CODEX_REVIEW_SUFFIX routing

## PR #1397 — fix(responses): preserve Codex custom_tool_call shape through translator (#1371)

- url: https://github.com/decolua/9router/pull/1397
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork custom_tool_call + customToolNames 12 hits; #3373 merged commit 2491812e1

## PR #1392 — Preserve Codex custom tool calls

- url: https://github.com/decolua/9router/pull/1392
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork custom_tool_call 7 hits; #3373 merged (commit 2491812e1) covers Responses custom tools

## PR #1387 — fix: inject json_schema into system prompt for openai-compatible providers (closes #1343)

- url: https://github.com/decolua/9router/pull/1387
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork default.js:98 applyJsonSchemaFallback is the modern replacement for json_schema prompt injection

## PR #1375 — Fix Provider Kiro erro: Improperly formed request

- url: https://github.com/decolua/9router/pull/1375
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork canonicalizeKiroConversation (kiroConversation.js:383) + tool-call repair cover improper request fix

## PR #1349 — fix(claude): normalize anthropic-version header

- url: https://github.com/decolua/9router/pull/1349
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork base.js:101-103 sets anthropic-version only when absent; header normalization done

## PR #1344 — fix: downgrade json_schema response_format to json_object for non-OpenAI providers

- url: https://github.com/decolua/9router/pull/1344
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork default.js:98 applyJsonSchemaFallback downgrades json_schema to json_object for openai-compatible

## PR #1297 — Update Antigravity Gemini Flash model

- url: https://github.com/decolua/9router/pull/1297
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork registry/antigravity.js:54-55 already has gemini-3.5-flash high/low tiers

## PR #1264 — fix(translator): strip temperature for Claude models with extended thinking

- url: https://github.com/decolua/9router/pull/1264
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork paramSupport.js:9 drops temperature for all Claude models (#1748 rule)

## PR #1257 — feat(codex): bulk-import accounts from JSON files

- url: https://github.com/decolua/9router/pull/1257
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork src/app/api/oauth/codex/bulk-import/route.js already bulk-imports codex accounts

## PR #1209 — fix(kiro): resolve Improperly formed request when tool_calls in history (#1184)

- url: https://github.com/decolua/9router/pull/1209
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork canonicalizeKiroConversation handles tool history: kiroConversation.js:383; commit 16cb40fda

## PR #1103 — feat(codex): allow multiple workspaces within the same OpenAI account

- url: https://github.com/decolua/9router/pull/1103
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork import-token route.js:25-88 workspace/chatgptAccountId per connection

## PR #1054 — Fix: support OpenAI's max_completion_tokens parameter (OpenAI API model testing)

- url: https://github.com/decolua/9router/pull/1054
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: redundant with open PR 3167/3174 (same max_completion_tokens rename, superset)

## PR #1007 — fix: normalize Codex custom tools (apply_patch) to { input: string } schema

- url: https://github.com/decolua/9router/pull/1007
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: custom tools normalized: fork custom_tool_call 7 hits + merged #3373 (commit 2491812e1)

## PR #1004 — fix(cx): stabilize Codex continue sessions

- url: https://github.com/decolua/9router/pull/1004
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork sessionManager.js:102-123 + codex.js:269,482 stable session_id

## PR #976 — fix(codex): preserve reasoning summary deltas

- url: https://github.com/decolua/9router/pull/976
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork openai-responses.js:148 emits response.reasoning_summary_text.delta

## PR #941 —  fix: keep Codex workspaces as separate connections

- url: https://github.com/decolua/9router/pull/941
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork connectionsRepo.js:113-131 codex keyed by chatgptAccountId

## PR #873 — fix(codex): strip unsupported n8n Responses API params

- url: https://github.com/decolua/9router/pull/873
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork codex.js:558-575 deletes + RESPONSES_API_ALLOWLIST

## PR #664 — fix: translate max_tokens to max_completion_tokens for openai-compatible providers (closes #560)

- url: https://github.com/decolua/9router/pull/664
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: redundant with open PR 3167/3174 which add max_completion_tokens rename to default.js

## PR #645 — fix: force Agent mode when Claude CLI routes through Cursor provider

- url: https://github.com/decolua/9router/pull/645
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork chatCore carries forceAgentMode for Cursor-routed Claude CLI

## PR #628 — fix: strip default values from tool schema in antigravity-to-openai (closes #561)

- url: https://github.com/decolua/9router/pull/628
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork antigravity-to-openai already normalizes schema defaults (normalizeSchemaTypes)

## PR #601 — feat: add direct Claude translators + fix 400 error

- url: https://github.com/decolua/9router/pull/601
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: direct claude-to-kiro/kiro-to-claude/gemini-to-claude translators all exist in fork

## PR #466 —  Fix responses transformer to properly close reasoning before message content

- url: https://github.com/decolua/9router/pull/466
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork responsesTransformer emits reasoning close before message content (msgContentAdded 3 hits)

## PR #421 — fix: coerce tool description to string in all translation paths

- url: https://github.com/decolua/9router/pull/421
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork claude-to-openai.js:72 String(description); openai-responses.js:200,221,450

## PR #420 — fix: convert Gemini body to OpenAI format in antigravity MITM handler

- url: https://github.com/decolua/9router/pull/420
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork src/mitm/handlers/antigravity.js handles streamGenerateContent Gemini bodies

## PR #3610 — feat(kiro): update model definitions and CLI tool mappings

- url: https://github.com/decolua/9router/pull/3610
- upstream-state: open (discovered 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: fork registry/kiro.js has GLM-5/DeepSeek-3.2 defs; cliTools mappings present

## PR #3083 — fix(usage): read cached_tokens from nested prompt_tokens_details

- url: https://github.com/decolua/9router/pull/3083
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork canonicalizeUsage already reads nested cached_tokens: open-sse/utils/usageTracking.js:202 usage.prompt_tokens_details?.cached_tokens (plus :439).

## PR #2909 — fix(qoder): show organization quota with zero total

- url: https://github.com/decolua/9router/pull/2909
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork ProviderLimits/utils.js:410-424 already skips zero-total qoder organization bucket and documents the remaining-as-credits trap.

## PR #2850 — fix(claude): guard inactive quota auto-ping

- url: https://github.com/decolua/9router/pull/2850
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork quotaAutoPing.js already implements the guards: wasPingedRecently :72, hasExhaustedBlockingQuota :83, reset-drift/shouldPingForReset :87, proxy resolution :197.

## PR #2762 — fix(pricing): stop billing reasoning tokens twice

- url: https://github.com/decolua/9router/pull/2762
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork pricing.js:2210-2224 has the identical reasoning-delta fix ('charge only the DELTA', (pricing.reasoning - pricing.output)).

## PR #2715 — docs(readme): update free-tier provider status for 2026 (#2661)

- url: https://github.com/decolua/9router/pull/2715
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork README.md:98 and README.zh-CN.md:85,282 already carry the '50 credits/month' wording the PR adds.

## PR #2668 — feat: include usage data in database backups

- url: https://github.com/decolua/9router/pull/2668
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork src/lib/db/backup.js:14 excludes only requestDetails; backupDbLite copies every other table incl. usageHistory/usageDaily.

## PR #2572 — fix(grok-cli): parse SuperGrok percent-based billing for quota tracker

- url: https://github.com/decolua/9router/pull/2572
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork usage/grok-cli.js already has unified-billing/SuperGrok weekly pool (:35,90,100) and monthlyLimit absolute window (:163-175).

## PR #2553 — feat(usage): show API key client activity

- url: https://github.com/decolua/9router/pull/2553
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: PR body self-declares: 'Split required. Current 61-file head is intentionally draft and must not merge.' 2498 ln.

## PR #2422 — fix: keep usage api key groups distinct

- url: https://github.com/decolua/9router/pull/2422
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Redundant with PR 2919 (same hashed byApiKey identity, 2919 is the most complete: ID + salted HMAC + all periods).

## PR #2364 — fix(usage): keep API key stats distinct

- url: https://github.com/decolua/9router/pull/2364
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Redundant with PR 2919 (same API-key identity grouping; 2919 supersedes with HMAC + id-based keys).

## PR #2210 — fix(usage): avoid API key stats collisions

- url: https://github.com/decolua/9router/pull/2210
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Redundant with PR 2919 (same SHA-256 byApiKey grouping; 2919 covers more periods and read sites).

## PR #2137 — fix: persist quota filter state

- url: https://github.com/decolua/9router/pull/2137
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork ProviderLimits/index.js:563-583 already restores account/provider filters from localStorage with hydration guard.

## PR #1898 — fix(usage): eliminate zero-token duplicate entries in streaming usage

- url: https://github.com/decolua/9router/pull/1898
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork already plumbs streamDetailId: chatCore.js:935 destructures from buildOnStreamComplete and passes it; streamingHandler.js:47 accepts it with detailId fallback.

## PR #1854 — feat(quota): persist per-account quota and skip out-of-quota Kiro accounts during routing

- url: https://github.com/decolua/9router/pull/1854
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork quotaPause.js derives per-account per-window pause wired at auth.js:93-100 (evaluateQuota); quota persistence covered by usage/[connectionId] route.

## PR #1819 — fix(codex): bind usage and quota calls to ChatGPT account

- url: https://github.com/decolua/9router/pull/1819
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork usage/codex.js:24-26 resolves ChatGPT account id and sends ChatGPT-Account-ID (:123-130) incl. reset credits. Only idToken-decode fallback missing.

## PR #1805 — fix(qoder): propagate upstream error status via HTTP status instead of SSE text, enabling combo/account fallback

- url: https://github.com/decolua/9router/pull/1805
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork qoder.js wrapQoderSSE peeks first frame and returns HTTP 403 on billing block so combo fallback triggers (:337-360); generalized non-200 handling is the only delta.

## PR #1738 — fix: count alternate usage token fields

- url: https://github.com/decolua/9router/pull/1738
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork usageRepo.js:64-66 already reads prompt_tokens||input_tokens, completion_tokens||output_tokens, cached_tokens||cache_read_input_tokens.

## PR #1681 — feat: per-key cost quota + request attribution for shared gateways

- url: https://github.com/decolua/9router/pull/1681
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Per-key quota/attribution superseded: fork already attributes apiKey (chatCore/requestDetail.js:97,124); quota enforcement subsumed by newer PR 2833 key-policy design.

## PR #1426 — Send account context for Codex usage

- url: https://github.com/decolua/9router/pull/1426
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork usage/codex.js sends ChatGPT-Account-ID (:130) and explicit connected message (:94); resetAt parse via parseResetTime (shared.js:15). Only relative-field parsing unverified.

## PR #1232 — fix: usage screen not update information with stream

- url: https://github.com/decolua/9router/pull/1232
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork UsageStats.js:277 already setStats((prev) => ({...prev, ...data})) plus SSE stream path at :295-310.

## PR #702 — fix #681: separate usage tracking for Ollama Cloud vs local instances

- url: https://github.com/decolua/9router/pull/702
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork has separate ollama.js vs ollama-local.js registries (distinct ids); clipboard fallback already in useCopyToClipboard.js:19-26.

## PR #600 — feat: allow api key restriction by quota, models

- url: https://github.com/decolua/9router/pull/600
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: April-era 889 ln key-policy feature; superseded by PR 2833's newer comprehensive design (expiry, quotas, model policies).

## PR #584 — feat: add minimum quota reserve and account cooldown

- url: https://github.com/decolua/9router/pull/584
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork quotaPause.js + auth.js:93-100 implement the reserve threshold (EditConnectionModal 'Pause buffer' index.js:1389); only post-reset cooldown not present.

## PR #424 — fix(usage): correct stats truncation at 10k requests and make history cap configurable

- url: https://github.com/decolua/9router/pull/424
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork fixed the truncation: atomic totalRequestsLifetime counter (usageRepo.js:325-328) + ring-based recents (:125). Fork keeps history unbounded instead of a configurable cap.

## PR #2799 — fix(combo): avoid Anthropic prefill 400 in fusion panel requests

- url: https://github.com/decolua/9router/pull/2799
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork combo.js:217 flattenToolHistory maps tool->user and :261 ensureTrailingUserTurn with identical prefill-400 rationale; both present

## PR #2242 — feat(capabilities): model capability metadata on `/v1/models`, combo aggregation, pattern fixes

- url: https://github.com/decolua/9router/pull/2242
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork /v1/models already emits capabilities: src/app/api/v1/models/route.js:126,466-467 with getCapabilitiesForModel import at :23

## PR #2018 — fix(combo): fetch models dynamically from custom provider endpoints

- url: https://github.com/decolua/9router/pull/2018
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork ModelSelectModal.js:129 already fetches /api/models/custom plus fetchProviderNodes; /api/providers/[id]/models route exists in fork

## PR #1497 — feat(combo): Smart Combo + Vision Auto-Routing + RU Mode — Russian fork enhancements

- url: https://github.com/decolua/9router/pull/1497
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Russian fork dump: 132 files, 16k+ lines incl. RU mode and fork-local features; not mergeable

## PR #1434 — fix: prevent circular dependencies in model combos (#1235)

- url: https://github.com/decolua/9router/pull/1434
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Circular-dep validation redundant with open PR 1423 (same fix, server-side); 1423's validateComboAcyclic is the fuller graph check

## PR #1395 — Fallback on empty tool-heavy combo streams

- url: https://github.com/decolua/9router/pull/1395
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork combo.js:112 peekStreamForContent + :528 empty-stream fallthrough covers #3463 empty tool-heavy streams incl. tool_call frames (frameCarriesContent)

## PR #2898 — feat(cli-tools): add Pi (pi.dev) coding agent support

- url: https://github.com/decolua/9router/pull/2898
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Pi (pi.dev) support redundant with open PR 1165 (same PiToolCard + pi.svg feature); keep one

## PR #2699 — fix(cli): default to IPv4-first DNS resolution to avoid undici IPv6 connect timeouts

- url: https://github.com/decolua/9router/pull/2699
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork cli.js:616 and :789 already spawn with --dns-result-order=ipv4first

## PR #2414 — fix(cli): fast-path help and version flags

- url: https://github.com/decolua/9router/pull/2414
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork cli.js:143-160 already handles --help/-h with Usage output; fast-path ordering partially differs but capability exists

## PR #2292 — fix(cli): rename next-server process to a unique name

- url: https://github.com/decolua/9router/pull/2292
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: next-server rename redundant with open PR 2133 (same rename); fork has no process.title set yet

## PR #1047 — feat(CLI Tools): add jcode integration with auto-configuration

- url: https://github.com/decolua/9router/pull/1047
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork already ships jcode: cliTools.js:345 entry, JcodeToolCard.js exists, wired in ToolDetailClient + components/index.js

## PR #361 — feat: Add Amp CLI support as a CLI tool destination

- url: https://github.com/decolua/9router/pull/361
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Root package.json bin/prepack packaging superseded by fork's cli/ package structure; Amp landed via cliTools.js:245 instead

## PR #3078 — fix(security): add /api/pxpipe to LOCAL_ONLY_PATHS — prevent unauthenticated RCE

- url: https://github.com/decolua/9router/pull/3078
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Already in fork: src/dashboardGuard.js:91 lists "/api/pxpipe" in LOCAL_ONLY_PATHS

## PR #2959 — test(api): add unit tests for count_tokens CORS preflight, 400 invalid JSON, and payload edge cases

- url: https://github.com/decolua/9router/pull/2959
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork already has tests/unit/count-tokens.test.js covering the same cases

## PR #2845 — feat(headroom): add optional Bearer Token auth

- url: https://github.com/decolua/9router/pull/2845
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Superseded: fork headroom.js:115 resolveHeadroomAuth + :384 sends Authorization Bearer from HEADROOM_API_KEY

## PR #1893 — fix(auth): preserve client IP behind local reverse proxy

- url: https://github.com/decolua/9router/pull/1893
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Superseded: fork custom-server.js:56-65 already implements loopback-proxy-trust XFF extraction with isLoopbackProxy

## PR #3614 — Merge GLM ZCode OAuth support from PR #1848

- url: https://github.com/decolua/9router/pull/3614
- upstream-state: open (discovered 2026-08-29)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Self-described merge of PR 1848, identical file set (zcode routes, glm executor); redundant with 1848

## PR #1792 — fix: remove --webpack flag and make auth redirects basePath-aware

- url: https://github.com/decolua/9router/pull/1792
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Overlapping basePath work; superseded by sibling PR 1793 which carries the same redirect fix

## PR #1773 — fix: include noAuth providers (opencode) in GET /v1/models

- url: https://github.com/decolua/9router/pull/1773
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork /v1/models already includes noAuth providers via freeModelSync (src/app/api/v1/models/route.js:610 comment + auth.js:46 FREE_PROVIDERS.noAuth)

## PR #1388 — fix: kiro validateImportToken uses social refresh endpoint to fix Unauthorized (closes #1363)

- url: https://github.com/decolua/9router/pull/1388
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Superseded: fork kiro.js refreshToken (line 177) already falls through to KIRO_AUTH_SERVICE/refreshToken (line 214) when no clientId, which validateImportToken:249 hits

## PR #717 — fix: align codex oauth models and request contract

- url: https://github.com/decolua/9router/pull/717
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Superseded: fork codex registry already carries newer contract (gpt-5.6-sol/terra/luna, open-sse/providers/registry/codex.js:48-52); PR targets 5.4-era list

## PR #520 — Security: Dangerous unauthenticated global package installation endpoint

- url: https://github.com/decolua/9router/pull/520
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Superseded: fork deleted the 9remote install route entirely (no src/app/api/9remote anywhere); PR's 404-stub end state already reached by removal

## PR #3215 — Fix CORS for preflight OPTIONS method

- url: https://github.com/decolua/9router/pull/3215
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Identical OPTIONS preflight fix to PR 3025 (same dashboardGuard.js hunk); redundant with 3025

## PR #1247 — fix(security): harden public API and local-only access gates

- url: https://github.com/decolua/9router/pull/1247
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Superseded: fork dashboardGuard.js already has isPublicLlmApi (:144), hasValidApiKey (:160), canAccessLocalOnlyRoute (:169) from this PR's content

## PR #621 — fix: try multiple Linux cert dirs and mkdir -p before installing Root CA (closes #558)

- url: https://github.com/decolua/9router/pull/621
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Superseded: fork src/mitm/cert/install.js LINUX_CERT_PATHS already covers Debian, Arch, Fedora/RHEL and openSUSE with per-distro commands

## PR #3291 — skills: add hermes-skill-prune

- url: https://github.com/decolua/9router/pull/3291
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: hermes-skill-prune is a personal Hermes workflow skill doc; no router code, no fork benefit

## PR #3245 — fix(rtk): inject the system prompt with the target API's content-part type

- url: https://github.com/decolua/9router/pull/3245
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork rewrote injector: appendToOpenAIMessage(msg,prompt,isResponses) typed INPUT_TEXT + instructions path (systemInject.js:59-80,33-35)

## PR #3204 — fix(system-inject): use chat-compatible content part type for array system messages (#3202)

- url: https://github.com/decolua/9router/pull/3204
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Same fix as 3245: fork systemInject.js:59-80 already types Responses parts input_text vs chat text

## PR #2956 — docs(i18n): fix typos, prompt artifact, and update RTK features in README.vi.md

- url: https://github.com/decolua/9router/pull/2956
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork i18n/README.vi.md already rewritten (line 8 'Kết nối tất cả công cụ…', no AI preamble)

## PR #2907 — feat(homebrew): add distribution support

- url: https://github.com/decolua/9router/pull/2907
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Homebrew tap release CI — upstream distribution infra; fork does not publish homebrew taps

## PR #2892 — merge

- url: https://github.com/decolua/9router/pull/2892
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Adds root app/layout.tsx + layout.tsx conflicting with fork src/app structure; rest is devcontainer/.nvmrc personal setup

## PR #2829 — feat(docker): comprehensive Docker Compose overhaul with monitoring and CI/CD

- url: https://github.com/decolua/9router/pull/2829
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Docker Compose monitoring/Caddy/prometheus overhaul — self-host deploy stack

## PR #2809 — fix(azure): normalize GPT-5 chat completion parameters

- url: https://github.com/decolua/9router/pull/2809
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Redundant with open PR 2691 which fixes the same Azure max_completion_tokens gap with a smaller diff

## PR #2764 — fix(server): initialize runtime services at process startup

- url: https://github.com/decolua/9router/pull/2764
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork src/instrumentation.js already boot-starts schedulers (startFreeModelSync + contextWindow overrides), replacing layout-driven bootstrap

## PR #2732 — docs: add Persian YouTube tutorial for connecting 9Router to coding a…

- url: https://github.com/decolua/9router/pull/2732
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Docs-only third-party Persian YouTube tutorial link in README; no code value

## PR #2685 — fix(cursor): HTTP/2 AgentService support + version bump to 3.12.17

- url: https://github.com/decolua/9router/pull/2685
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Already merged in fork: commit 6994cd1f7 'fix(cursor): HTTP/2 AgentService support + version bump to 3.12.17'

## PR #2528 — Railway 

- url: https://github.com/decolua/9router/pull/2528
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: CI-only Claude PR-review workflow + Railway deploy bits — upstream CI, not fork runtime

## PR #2474 — Add Node.js CI workflow

- url: https://github.com/decolua/9router/pull/2474
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Upstream Node.js CI workflow; fork runs its own test gates, no upstream CI to satisfy

## PR #2316 — fix(mitm): add in-process guard to prevent concurrent startServer() calls

- url: https://github.com/decolua/9router/pull/2316
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork startMitm already throws 'MITM server is already running' (manager.js:490) guarding concurrent start

## PR #2300 — fix(mitm): auto-generate Root CA on first run instead of exiting (#2224)

- url: https://github.com/decolua/9router/pull/2300
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork mitm/server.js:60-63 generates Root CA when missing ('Root CA missing, generating...')

## PR #2172 — feat(deployment): add Cloudflare Pages/Workers deployment support + p…

- url: https://github.com/decolua/9router/pull/2172
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Cloudflare Pages/Workers deployment support — personal deploy stack

## PR #1833 — chore: remove stale file, dead config entry, and fix README typo

- url: https://github.com/decolua/9router/pull/1833
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork has no openai-to-kiro.old.js and providers.js is a 19-line registry barrel (no opencode entry to remove)

## PR #1666 — fix: mask request debug logs

- url: https://github.com/decolua/9router/pull/1666
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Redundant with open PR 2709 — both enable requestLogger masking; take 2709

## PR #1558 — fix(docker): include MITM runtime files missing from Next standalone output + document /etc/hosts mount modes

- url: https://github.com/decolua/9router/pull/1558
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork Dockerfile already copies src/mitm + node-forge (Dockerfile:35-37); remainder is docs-only

## PR #1436 — Merge pull request #1 from decolua/master

- url: https://github.com/decolua/9router/pull/1436
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Empty diff (gh pr diff returns nothing) — merge-commit PR with no content

## PR #1374 — chore: remove AI-generated intro

- url: https://github.com/decolua/9router/pull/1374
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork i18n/README.vi.md already has AI intro removed

## PR #1115 — fix: prevent reasoning_content from being deleted unconditionally

- url: https://github.com/decolua/9router/pull/1115
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork already preserves reasoning_content when content empty (nonStreamingHandler.js:494-500 conditional delete)

## PR #1074 — Change export syntax from default to module.exports

- url: https://github.com/decolua/9router/pull/1074
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Fork postcss.config.mjs uses valid ESM export default; PR's module.exports swap solves a non-issue here

## PR #1041 — fix: Next standalone Docker start path

- url: https://github.com/decolua/9router/pull/1041
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: skipped
- closed: 2026-08-29
- detail: Fork Dockerfile CMD is custom-server.js (Dockerfile:56), not bare server.js — PR's app/server.js path change inapplicable

## PR #652 — fix: guard against corrupt JSON in request-details.json DB (closes #506)

- url: https://github.com/decolua/9router/pull/652
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork requestDetailsDb.js is now a shim to SQLite layer (line 1-5); lowdb corrupt-JSON path eliminated

## PR #650 — fix: remove false fs dependency from package.json (closes #528)

- url: https://github.com/decolua/9router/pull/650
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork package.json has no "fs" dependency; PR's replacement hunk is also malformed JSON ('"clsx",')

## PR #447 — fix(db/docker): bootstrap db.json on first run & set DATA_DIR in Docker

- url: https://github.com/decolua/9router/pull/447
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork SQLite layer self-bootstraps (driver.js:56 ensureDirs, schema.js:203 CREATE TABLE IF NOT EXISTS) and Dockerfile sets DATA_DIR (line 27)

## PR #290 — feat: respect Accept header for response format negotiation

- url: https://github.com/decolua/9router/pull/290
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: Fork chatCore.js:215-229 already implements Accept-header JSON vs SSE negotiation

## PR #2837 — docs(readme): replace Roo Code branding with Zoo Code

- url: https://github.com/decolua/9router/pull/2837
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 5aed7f162; README Roo Code cell replaced with Zoo Code (zoocode.png byte-verified vs upstream blob)

## PR #1161 — My master

- url: https://github.com/decolua/9router/pull/1161
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 95531c8f1 (86fa57dff); docker publish bound to 127.0.0.1 across 23 doc files + start.sh + docker-compose.yml, zero residual exposed bindings

## PR #2812 — docs: prioritize English setup video in Video Guides

- url: https://github.com/decolua/9router/pull/2812
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 015016f4c; English setup video first in Video Guides, adapted to fork card order

## PR #3618 — Add GLM-5.3-Flash and DeepSeek V4 Vision patterns

- url: https://github.com/decolua/9router/pull/3618
- upstream-state: open (discovered 2026-08-29)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge f5d3b7f55 (11e5c68f4); *glm-5.3-flash* vision/video/pdf pattern + *glm-5.3* effort row in PATTERN_CAPABILITIES; capabilities.test 15/15

## PR #3616 — fix: all sse handler endpoints (chat, imagegeneratio... in chat.js

- url: https://github.com/decolua/9router/pull/3616
- upstream-state: open (discovered 2026-08-29)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 7abcd605e (c89d64f97); +20-line sliding-window rate limiter (60 req/min) on src/sse/handlers/chat.js keyed by api key

## PR #3342 — fix(codebuddy-cn): make the system-prompt length gate tunable and loud

- url: https://github.com/decolua/9router/pull/3342
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge e6572967e (7a0ac9e7c); CODEBUDDY_SYSTEM_PROMPT_MAX_LEN env knob + loud warn; 4 codebuddy test files

## PR #3332 — fix(opencode-go): keep DeepSeek on chat completions + normalize (max)

- url: https://github.com/decolua/9router/pull/3332
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 4107b82b6 (0cf5cf067); deepseek-v4-pro/flash supportedFormats reduced to [openai]; fork vision-exp row untouched; opencode-go-models tests updated

## PR #3331 — fix(auth): disable Qoder connection on quota exhaustion (403/code 112)

- url: https://github.com/decolua/9router/pull/3331
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 779ebc1d2 (4ac0a6a68); isQoderQuotaExhausted() 403/code-112 deactivation in markAccountUnavailable; qoder-quota-112-disable.test.js

## PR #3330 — fix(auth): give no-auth free providers a stable upstream session id

- url: https://github.com/decolua/9router/pull/3330
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 4d4a119bf (4b39c99ae); noauth creds carry connectionId:'noauth' so deriveSessionId is stable; noauth-session-id-3262.test.js

## PR #3311 — Sửa Test Connection Xiaomi Token Plan theo vùng

- url: https://github.com/decolua/9router/pull/3311
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 118993aef (9adb24663); resolveXiaomiTokenplanModelsUrl() region-aware + isXiaomiTokenplanTestResponseValid(); 7 new tests

## PR #3310 — Sửa đối số tool call và khả năng Xiaomi Token Plan

- url: https://github.com/decolua/9router/pull/3310
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 302ca4eb8 (5bafdb283+3e17b42bf); XIAOMI_TOKENPLAN_CAPABILITIES + ensureToolCallIds normalizes empty args to {}; 37 tests

## PR #3284 — feat(cowork): add Lians memory plugin

- url: https://github.com/decolua/9router/pull/3284
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 5b7861ef4 (d83c6bcee); lians-memory cowork plugin entry + setupUrl link; cowork-lians-memory.test.js

## PR #3265 — feat(commandcode): add per-connection ZDR toggle

- url: https://github.com/decolua/9router/pull/3265
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 751b00459 (4aba4ba0d); commandcode x-cmd-zdr header + AddApiKey/EditConnection ZDR toggle (hand-ported UI); 4 zdr test files; fixed committed conflict artifact in EditConnectionModal.js

## PR #3254 — fix(translator): treat an empty tool_calls array as no tool calls

- url: https://github.com/decolua/9router/pull/3254
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 19ee17abb (356743d9a); msg.tool_calls?.length so empty [] treated as no tool calls in formats/openai.js

## PR #3252 — fix(models): let a curated custom-provider model list suppress the live catalog

- url: https://github.com/decolua/9router/pull/3252
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge fca693a8d (4922a908b); customModels whitelist moved above live-catalog gate; custom-provider-model-list-3115.test.js

## PR #3328 — fix(providers): add the missing Fish Audio and Alibaba Cloud brand icons

- url: https://github.com/decolua/9router/pull/3328
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 667435127 (01efab706); fish-audio/alims-intl/alitp-intl brand PNGs + provider-brand-icons contract test (fork convention-path resolution, no map change)

## PR #3317 — feat(cli-tools): add OpenClaude support

- url: https://github.com/decolua/9router/pull/3317
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 9989d671b (3ee8f7804); openclaude cliTools card + icon + openclaude-cli-tool-1807.test.js

## PR #3316 — feat(codex): hiển thị service tier thực tế trong log

- url: https://github.com/decolua/9router/pull/3316
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 7da58076b (389ddd501); codex effective service_tier TIER log line, once per execute; codex-tier-log-3239.test.js

## PR #3314 — fix(cli): ngăn cài SQLite native khi khởi động

- url: https://github.com/decolua/9router/pull/3314
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge f30b59c81 (e4b2f0d7c); ensureSqliteRuntime installBetterSqlite=false, better-sqlite3 postinstall-only (12.6.2->12.10.1); startup never spawns npm

## PR #3231 — feat: Add fallback cmodel (Cantus) for Qoder provider

- url: https://github.com/decolua/9router/pull/3231
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 6358049e6 (301b608ff); qoder catalog cmodel (Cantus) fallback +41 in fetchQoderCatalogRaw; 62 qoder tests

## PR #3219 — fix(auth): stop truncating upstream error text mid-reason

- url: https://github.com/decolua/9router/pull/3219
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 76aeb0241 (fbe264893); ACCOUNT_ERROR_MESSAGE_MAX_CHARS=2000 in describeProviderError (fork's clip site post-3424); provider-error-detail-3424 updated

## PR #3211 — feat(providers): add Novita AI provider support

- url: https://github.com/decolua/9router/pull/3211
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 0bbd547c1 (e28da4e3d); novita registry p76 + models-fetch + testUtils/validate cases + baselines regenerated; novita-provider.test.js

## PR #3206 — feat(server): optional API-only port

- url: https://github.com/decolua/9router/pull/3206
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 02dc03530 (81175df85); optional API_PORT/API_HOSTNAME loopback-default API-only listener in custom-server.js, /v1+/v1beta+/responses+/codex gated; PR's keyPolicy/migration hunks skipped (fork divergence)

## PR #3191 — fix(providers): add TokenRouter connection test support

- url: https://github.com/decolua/9router/pull/3191
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 27fa6d041 (agent/wf_e867883b-3a7-1); tokenrouter connection-test case in testUtils.js

## PR #3179 — fix(runtime): coordinate graceful shutdown flushes

- url: https://github.com/decolua/9router/pull/3179
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 21962d675 (agent/wf_e867883b-3a7-2); src/lib/shutdown.js priority-grouped flusher registry wired into shutdown routes + SQLite adapters; fork shutdown posture preserved; db-adapter-shutdown test updated

## PR #3174 — fix(openai): handle Luna function tools on Chat Completions

- url: https://github.com/decolua/9router/pull/3174
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge ef4df8536 (586696383+bd601251f+fork fixes e345c9576/f64b44034); 64-char-cap tool-call id normalization + luna reasoning_effort=none with tools skipped on responses source; force-stream sync + max_completion_tokens in DefaultExecutor

## PR #3172 — Fix/executors cancel sse readers

- url: https://github.com/decolua/9router/pull/3172
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 5437df40d (ebc4ffb8c); reader.cancel() before releaseLock in grok-web/perplexity-web

## PR #3171 — Fix/mimo free session affinity

- url: https://github.com/decolua/9router/pull/3171
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 6d49c629d (agent/wf_e867883b-3a7-5); mimo-free x-session-affinity from credentials.connectionId; 29 mimo tests

## PR #3168 — fix(iflow): add accessToken authorization fallback

- url: https://github.com/decolua/9router/pull/3168
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge a59f4226e (479aa5622); iflow buildHeaders apiKey||accessToken fallback; iflow-executor.test.js

## PR #3137 — fix(vertex): validate RSA-2048 requirement for SA private key before jose RS256 signing

- url: https://github.com/decolua/9router/pull/3137
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 5e49881f9 (agent/wf_2b5f748e-3d2-1); validateVertexSaKey RSA>=2048 pre-import check wired into refreshVertexToken + validate route

## PR #3125 — fix(combos): resolve provider-prefixed combo names to member models

- url: https://github.com/decolua/9router/pull/3125
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 383a52809 (agent/wf_2b5f748e-3d2-2); combo provider-prefixed names fall back to basename resolution; combo-slash-resolve.test.js

## PR #3124 — feat(providers): add Meta AI (Muse Spark) via the Meta Model API

- url: https://github.com/decolua/9router/pull/3124
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge de1804a38 (ead3a92f5); Meta AI (Muse Spark) registry p124 + capabilities/pricing/thinking wiring + icon; meta-ai.test.js 7 cases

## PR #3114 — fix(antigravity): preserve schema-keyword property names

- url: https://github.com/decolua/9router/pull/3114
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge dd4884db3 (bce7692c5); isSchema-aware removeUnsupportedKeywords preserves schema-keyword property names; antigravity-schema-cleaner.test.js

## PR #3087 — feat(headroom): add lossless mode to proxy start

- url: https://github.com/decolua/9router/pull/3087
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge fb32282a9 (agent/wf_2b5f748e-3d2-5); headroom --lossless flag + headroomLossless setting; conflict kept fork kompress default-on

## PR #3066 — fix(headroom): skip compress on oversize payloads + disable kompress by default

- url: https://github.com/decolua/9router/pull/3066
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 6756afe2a (e3ebd3be6); MAX_COMPRESS_BODY_BYTES 256KB fail-open gate + kompress opt-in (settings.headroomKompress===true); conflict kept fork !==false default in routes, lossless added

## PR #3062 — feat(combos): add import/export with capacity adapter support

- url: https://github.com/decolua/9router/pull/3062
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 14014df5e (4c8a62622+19a5cadc2); combos import/export routes + fork page.js hand-merged keeping free-sync/capacity-adapter UI; combos-import-export.test.js

## PR #3058 — fix: correct AssemblyAI STT auth header

- url: https://github.com/decolua/9router/pull/3058
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 5e248fac2 (3683ff354); buildAuthHeaders authorization case + AssemblyAI form fields; assemblyai-stt.test.js

## PR #3057 — feat: add OpenCode Zen (PAYG) provider

- url: https://github.com/decolua/9router/pull/3057
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 19801baad (c46a3d66a); opencode-zen executor+registry p125+icon alias; 61 models; note: its catalog duplicates opencode-go ids, resolved by follow-up 01ee90dff deterministic bare-id owner

## PR #3047 — feat(usage): TokenRouter quota tracker via optional Management Key

- url: https://github.com/decolua/9router/pull/3047
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge a080538ea (b42967975); tokenrouter usage handler + USAGE_HANDLERS + management-key UI in fork's restructured modals; tokenrouter-usage.test.js 8/8

## PR #3042 — feat(combos): add combo test runner and fallback sequence diagnostic

- url: https://github.com/decolua/9router/pull/3042
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 0d02c72c2 (f5ff238f7); combo test-run routes + ComboTestModal wired into fork page; fork max_tokens:1024 probe kept (PR's 64 would regress #3010)

## PR #3025 — fix: exempt OPTIONS preflight from auth on /v1/* paths (#1381)

- url: https://github.com/decolua/9router/pull/3025
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge cc6219174 (5e1a10e85); OPTIONS preflight 204+ permissive CORS for PUBLIC_PREFIXES in dashboardGuard proxy()

## PR #2997 — fix(proxyFetch): add undici connection pooling to prevent connection exhaustion

- url: https://github.com/decolua/9router/pull/2997
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 8f1cf7673 (e068ca8af); ProxyAgent pooling opts (64 conns, keepAlive, pipelining, timeouts) onto fork's LRU dispatcher cache; PR's bypass-agent rewrite skipped (fork SNI-pinned createBypassRequest is deliberate)

## PR #2972 — feat(usage-stats): change default view mode from 'costs' to 'tokens'

- url: https://github.com/decolua/9router/pull/2972
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 54164ace4 (c90b463f9); UsageStats default view mode tokens; PR's SSE-merge revert + render simplification skipped (fork-divergent)

## PR #2957 — fix(tests): remove hardcoded Unix /tmp/node_modules paths for cross-platform vitest support

- url: https://github.com/decolua/9router/pull/2957
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge d72320662 (afd379f09); minimax-m3 test hint now cd tests && npx vitest run

## PR #2946 — fix(chat): replay Envoy buffer overflow on same account

- url: https://github.com/decolua/9router/pull/2946
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 41201e4f8 (641036abd); isRequestReplayBufferError 507 guard + one pinned same-account retry via preferredConnectionId; 2 new test files, 13 cases

## PR #2922 — fix(tunnel): bypass worker self-signed TLS via TUNNEL_WORKER_INSECURE

- url: https://github.com/decolua/9router/pull/2922
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge ed64d81b2 (7b84c4700); workerFetch rejectUnauthorized=false scoped to WORKER_URL host, opt-in TUNNEL_WORKER_INSECURE; tunnel-worker-fetch.test.js

## PR #2921 — fix(cli-tools): mark Amp as unsupported

- url: https://github.com/decolua/9router/pull/2921
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 1e143a476 (1601b4592); Amp marked unsupported:true + ToolSummaryCard Unsupported branch + DefaultToolCard error notes

## PR #2887 — fix(openrouter): opt into provider fallback for `openrouter/fusion` e…

- url: https://github.com/decolua/9router/pull/2887
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 7efa2c387 (4e1ad34f4); OpenRouterExecutor (super openrouter) allow_fallbacks injection + parseUpstreamError Stealth 502/500 hint; resetsAtMs untouched; 11-case test

## PR #2857 — fix(docker): remediate trivy HIGH/CRITICAL findings in the Docker image

- url: https://github.com/decolua/9router/pull/2857
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 881fa1b21 (2819278c6+db2aef3c3); docker image strips npm/corepack/yarn, postcss ^8.5.18 + sharp ^0.35.0 overrides, GitLab PAT placeholder masked

## PR #2853 — fix(codex): preserve quota window duration

- url: https://github.com/decolua/9router/pull/2853
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 4358be2fd (30fb4b3f3); formatCodexWindow windowSeconds from limit_window_seconds/window_seconds; codex-usage-windows.test.js

## PR #2847 — feat(models): expose runtime LLM capabilities in models info

- url: https://github.com/decolua/9router/pull/2847
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge bda499c4a (98e032553); models info route runtime capability derivation (overrides + contextWindow precedence); models-info-capabilities.test.js 6 cases

## PR #2824 — feat(ollama): add embedding provider adapter and endpoint support for Ollama Local

- url: https://github.com/decolua/9router/pull/2824
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 78c8dc7dd (7b689956f); ollamaLocal embedding adapter + registry models/serviceKinds/embeddingConfig; 3 new embeddingsCore cases

## PR #2822 — fix(logs): stop writing provider tokens to disk in request logs

- url: https://github.com/decolua/9router/pull/2822
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 0d4ddde27 (e930795fd); maskSensitiveHeaders active with PR allowlist, scheme prefix + last-4 kept; logProviderResponse headers masked; fork's DISABLED comment removed (security posture override of fork's old test-time decision)

## PR #2811 — Include commandcode cache reads in usage statistics

- url: https://github.com/decolua/9router/pull/2811
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 9ea8bb91c (d089921c9); commandcode usage extractor surfaces cachedInputTokens as cachedTokens when >0

## PR #2798 — fix(proxy-pools): increase relay test timeout to 30s and use reliable test endpoint

- url: https://github.com/decolua/9router/pull/2798
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 62bc3472c (87b87b800); relay test timeout 30s + api.ipify.org target

## PR #2783 — fix(translator): carry Structured Output across the Chat ⇄ Responses hop

- url: https://github.com/decolua/9router/pull/2783
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge f962e255c (20e44b326+32b64ee46); jsonFence util + response_format carry across Chat<->Responses + client-JSON unfence hooks in default/openai-to-claude prompts, nonStreamingHandler, sseToJsonHandler; 14 new tests

## PR #2776 — fix(db): encrypt provider connection secrets at rest (AES-256-GCM)

- url: https://github.com/decolua/9router/pull/2776
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 11354418c; secretCol helper AES-256-GCM at rest (enc1: prefix, legacy plaintext fallback) wired in connectionsRepo/exportDb/importDb/importLegacyMain; DB_ENCRYPTION_KEY env; secretCol.test.js

## PR #2775 — fix(privacy): disable Google Analytics by default, add opt-in toggle

- url: https://github.com/decolua/9router/pull/2775
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 4fdb28040 (fc8daf7b2); analyticsEnabled:false default, Privacy card toggle in fork's rewritten profile page

## PR #2724 — feat(grok): show current-day request usage

- url: https://github.com/decolua/9router/pull/2724
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge cdfd839b5 (a3ef8e4a7); getDailyConnectionUsage daily meter, 800/day grok-cli fallback quota; grok-daily-usage-route.test.js

## PR #2706 — fix(minimax): normalize unsigned thinking block starts

- url: https://github.com/decolua/9router/pull/2706
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge ab9cfff18 (8588c6339); ensureThinkingSignature minimax quirk + stream.js unsigned-start normalization (conflict re-applied to fork's passthrough block); minimax-thinking-signature.test.js

## PR #2691 — fix(azure): send max_completion_tokens for gpt-5/o-series reasoning deployments

- url: https://github.com/decolua/9router/pull/2691
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 0aa240e12 (b5e96f9e9); azure requiresMaxCompletionTokens + explicit max_completion_tokens precedence; azure-executor.test.js 8 cases

## PR #2686 — fix(combos): show non-media combo kinds

- url: https://github.com/decolua/9router/pull/2686
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 15e343976 (3538acdb6); combos page MEDIA_PROVIDER_KINDS filter

## PR #2683 — chore(deps): bump actions/setup-node from 6 to 7

- url: https://github.com/decolua/9router/pull/2683
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge db7ab96d2 (0dc8c2ece); gitbook-pages.yml setup-node v7

## PR #2658 — fix(usage): include Claude cache tokens in prompt totals

- url: https://github.com/decolua/9router/pull/2658
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 6d14f0074 (51df193ef); claudeUsageToOpenAI in usageTracking replaces hand-rolled non-streaming Claude usage; claude-nonstreaming-usage.test.js

## PR #2634 — fix(translator): flatten multi-block text content parts, preserve multimodal

- url: https://github.com/decolua/9router/pull/2634
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 3c428603d (89081af47); collapseTextParts joins multi-block text-only parts with newline, multimodal preserved

## PR #2622 — fix(translator): stop leaking literal <think>/</think> markers into OpenAI content

- url: https://github.com/decolua/9router/pull/2622
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 0edb3f292 (0a0d9f5de); thinking-tag leak removed (reasoning_content only) + closeReasoning on reasoning->content transition in openai-responses; supersedes open PRs 980/2190

## PR #3613 — feat(codex): show OAuth subscription expiry

- url: https://github.com/decolua/9router/pull/3613
- upstream-state: open (discovered 2026-08-29)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 011e51a43 (b23960347 adapted); codex subscription entitlement (JWT fast-path, accounts/check, psd cache) + ProviderLimits expiry badge; union-merged with fork's grok daily meter in usage route; fork quota-snapshot persist preserved; 58 test cases

## PR #3612 — fix(fallback): parse provider-reported rate-limit reset times

- url: https://github.com/decolua/9router/pull/3612
- upstream-state: open (discovered 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 5e435f42d (ae31738ef+5c8b3a226); extractResetsAtMs generic GLM/retry/Retry-After parsing wired into parseUpstreamError 429 paths + MAX_RATE_LIMIT_COOLDOWN_MS 30min->6h; fork's base.js parseError defers correctly

## PR #3611 — fix(stream): passthrough dedup/normalization + OpenAI non-stream contract

- url: https://github.com/decolua/9router/pull/3611
- upstream-state: open (discovered 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge cfd86f4c5 (7d65768bf); passthrough finish-chunk/[DONE] dedupe + delta.reasoning normalization only; chatCore stream-default + 502 aborts excluded (superseded by streamMode/2392/882)

## PR #3333 — fix(tools): DeepSeek same-name tool dedup + endpoint matrix tests

- url: https://github.com/decolua/9router/pull/3333
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 5602297af (db2bfc421); dedupeTools(tools,{clientTool,model}) extended signature, deepseek same-name dedup first-wins; chatCore call site unconditional; tool-deduper.test.js 11 cases

## PR #3329 — w

- url: https://github.com/decolua/9router/pull/3329
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 47d0d57f1 (7b8111114); claude-adaptive omits output_config at auto; claude-budget auto emits budget_tokens:10000; sonnet-5 adaptive pattern + fable/mythos flipped

## PR #3325 — Adaptive unsupported parameter stripper

- url: https://github.com/decolua/9router/pull/3325
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 1e97717cb (188f80425); adaptiveStripper concerns/ module wired at fork's stripContinuityFields + 400-retry (one retry, 3403 pass semantics kept); 16 tests

## PR #3321 — fix(opencode): stop zen free-tier 429 — official client fingerprint + manual egress switch

- url: https://github.com/decolua/9router/pull/3321
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge a24cd453f (66b4db7b2); ocEgress flip util + x-real-ip scrub + versioned UA; session stash moved per-request (fixes concurrent bleed); codebuddy hunk skipped

## PR #3320 — feat(antigravity): update Antigravity IDE fingerprint version to 2.5.5

- url: https://github.com/decolua/9router/pull/3320
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 99437d611 (229db6f4c+d04dc6e78); ANTIGRAVITY_IDE_VERSION 2.5.5 single-sourced (mitm hardcode deleted, requires shared.js); ide-version-sync test

## PR #3318 — fix(translator): wrap array tool outputs in object for Gemini/Antigravity functionResponse

- url: https://github.com/decolua/9router/pull/3318
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 025bc578a (3a40b8fe8); functionResponse array/primitive wrap on Gemini + Claude tool_result paths (PR intent; upstream's final state reverted the guard so intent ported); unrelated hunks skipped

## PR #3313 — fix(security): chặn SSRF khi kiểm tra provider node

- url: https://github.com/decolua/9router/pull/3313
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 840606b0e (7b58c7528+fbd189d9d+5ddebc750); DNS-aware ssrfGuard + fetchPublicUrl wiring for remote provider-node validate; fork's AbortSignal fetchWithTimeout signature kept; 48 tests

## PR #3297 — fix(responses): forward usage on streamed response.completed

- url: https://github.com/decolua/9router/pull/3297
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 604c22878; toResponsesUsage + completionPending deferral + estimated usage pre-flush for Responses clients; antigravity pivot null-usage regression fix; overlaps 3075 (test shapes same)

## PR #3295 — fix(ollama-local): verbose debug diagnostics + timeout/retry tuning

- url: https://github.com/decolua/9router/pull/3295
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 2061da7c3 (84ce16ff0); OLLAMA_LOCAL_CONNECT_TIMEOUT_MS in runtimeConfig + 502/503/504 retry disable + debug diagnostics; base.js fmtBytes

## PR #2709 — fix(logging): redact credentials from request logs

- url: https://github.com/decolua/9router/pull/2709
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: maskSensitiveHeaders active since PR 2822 merge (0d4ddde27, batch 22); same allowlist + last-4 scheme; request-logger-masking.test.js in tree

## PR #2600 — fix(huggingface): add sttConfig so HF STT presets are dispatchable

- url: https://github.com/decolua/9router/pull/2600
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge b994d82ff (f1d7cd60d); huggingface sttConfig (api-inference models, bearer, huggingface-asr format); hf-model-routing tests

## PR #2573 — fix(byteplus): use standard ModelArk endpoint, not Coding Plan endpoint

- url: https://github.com/decolua/9router/pull/2573
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 147a0f727; byteplus transport.baseUrl /api/coding/v3 -> /api/v3; golden-url-header snapshot updated in f2913bbb9

## PR #2554 — fix(console-log): fall back when tunnels buffer SSE

- url: https://github.com/decolua/9router/pull/2554
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge cb3f64a9b (17732dfc8); console-log transport: REST snapshot, SSE 5s watchdog, ETag/304 poll fallback; buffer revision counter; 5 tests

## PR #2542 — fix(headroom): allow larger prompt compression to finish

- url: https://github.com/decolua/9router/pull/2542
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 1a771b882 (30da32743+d0c0eedaa); rtk headroom DEFAULT_TIMEOUT_MS 3000->15000 (chatCore plumbing already present); fixed pre-existing missing beforeEach import; headroom.test.js 49/49

## PR #2526 — fix(combos): hide disabled provider connections

- url: https://github.com/decolua/9router/pull/2526
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge f6387ec1b (3834dc3cf); filterActiveConnections in connectionStatus + combos page wiring; connection-status.test.js

## PR #2443 — fix: prevent duplicate system prompt injection in multi-turn conversations

- url: https://github.com/decolua/9router/pull/2443
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge e127c4341 (11b02faa5); isPromptAlreadyInjected 100-char signature guard across all six systemInject paths (OpenAI/Responses/Claude/Gemini); 20 dedup tests

## PR #2437 — feat: add Chenzk API provider

- url: https://github.com/decolua/9router/pull/2437
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 79287b136 (de93245ee+cff328d08); chenzk registry p126 + icon + 16 seed models + baselines re-snapshotted; chenzk-provider.test.js

## PR #2399 — fix(translator): register openai response projection for gemini-family clients

- url: https://github.com/decolua/9router/pull/2399
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 723150e6f (e40ca0c81); openai-to-gemini response projection for GEMINI/GEMINI_CLI/VERTEX + translator index wiring; 6 tests

## PR #2396 — fix(translator): make commandcode ensureState idempotent regardless of pre-set responseId

- url: https://github.com/decolua/9router/pull/2396
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 1256a6d99 (53a77d94a); ensureState field-wise ??= idempotency; fork error-role tests preserved (upstream replacement would delete them); self-check script 4/4

## PR #2340 — fix(kimchi): implement dynamic User-Agent version detection

- url: https://github.com/decolua/9router/pull/2340
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge f85d613df (d71911d8f); kimchiUserAgent dynamic GitHub release lookup (1h throttle/4h refresh), registry headers getter, oauth-only; fixes pre-existing category test failure; golden snapshot updated

## PR #2324 — fix(cli): stop Headroom proxy on shutdown and before npm upgrade (EBUSY #2265)

- url: https://github.com/decolua/9router/pull/2324
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge e5fa6564e (de81793f2); cli.js headroom proxy.pid cleanup at both kill sites (killByPidFile reuse); PR's other files out of brief

## PR #2190 — fix(claude): keep thinking out of visible content

- url: https://github.com/decolua/9router/pull/2190
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: superseded
- closed: 2026-08-29
- detail: thinking-tag leak + closeReasoning landed via PR 2622 merge 0edb3f292 (batch 23), which is the superset; 980/2190 both redundant

## PR #2313 — feat(kenari): add Kenari OpenAI-compatible gateway provider

- url: https://github.com/decolua/9router/pull/2313
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 53127ea9e (be0588035); kenari registry p127 (badge-fallback, no upstream mark); 44 provider tests

## PR #2294 — Add Nube.sh OpenAI-compatible provider

- url: https://github.com/decolua/9router/pull/2294
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 907daab11 (ae3e4b5e9+4b48e8753); nube p128 + icon + baselines re-snapshotted; conflict resolved by renumbering (nube p128, firecrawl p129)

## PR #2291 — fix(mitm): replace net session with fltmc for Windows admin check

- url: https://github.com/decolua/9router/pull/2291
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge ff1227633 (74cd1b533); fltmc replaces net session in winElevated + antigravity-mitm route; mitm-admin-check.test.js

## PR #2253 — feat: add self-hosted FireCrawl provider

- url: https://github.com/decolua/9router/pull/2253
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge b0e7d13bf (5aeb1ff76)+220b825b4+393f618d6; firecrawl_custom p129, env-based FIRECRAWL_* config, /v2/scrape, no-auth custom; fixture credential literals restructured to pass secret-scan; 9 tests

## PR #2247 — fix: guard against null modelAliases values causing startsWith crash

- url: https://github.com/decolua/9router/pull/2247
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 912ea9166 (711a573a1); ModelSelectModal typeof-string guards before startsWith

## PR #2216 — fix: cleanup MITM hosts on exit

- url: https://github.com/decolua/9router/pull/2216
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 2979efcf3; cli/hooks/cleanupMitmHosts.js wired at both kill sites + SIGTERM-before-SIGKILL sleepSync(400); prefers fork dnsConfig removeAllDNSEntriesSync

## PR #2178 — fix(embeddings): forward input_type to provider request body

- url: https://github.com/decolua/9router/pull/2178
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge e4d887c70 (68c5294e0); buildBody forwards input_type; openai embedding provider passes when set; 54 tests

## PR #2177 — Remove Deno Deploy relay option

- url: https://github.com/decolua/9router/pull/2177
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge e448d4ea7 (053120ae3); Deno Deploy relay removed (route, page modal, VALID_PROXY_TYPES, connectionProxy checks)

## PR #2147 — feat(xai): register XaiExecutor with reasoning-effort suffix parsing and allow/deny list

- url: https://github.com/decolua/9router/pull/2147
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge c3d49b0b5; XaiExecutor registered (import + registration + re-export); xai-executor.test.js 4 cases

## PR #2143 — fix(github): drop trailing assistant prefill for Copilot chat

- url: https://github.com/decolua/9router/pull/2143
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 3f6bf7cb1 (cb586cb8e); github dropTrailingAssistantPrefill in sanitizeMessagesForChatCompletions; 6 tests

## PR #2140 — feat(fireworks): replace deprecated models with 16 new LLMs, provider pricing/capabilities, and logo

- url: https://github.com/decolua/9router/pull/2140
- upstream-state: open (seeded 2026-08-28)
- local-status: queued
- branch: 
- local-ref: 
- disposition: 
- validation: 
- notes:
- final-disposition: integrated
- closed: 2026-08-29
- detail: merge 1c66e8bfa (52b05a7fd); fireworks 16 current LLM rows + thinkingConfig, capabilities thinkingFormat openai, PROVIDER_PRICING rates, real 256px logo; 28 tests

