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

### 2026-08-28 — session 2 continued: tick 5 complete
- Batch 9: #3516 (lock expiry), #3515 (observability precedence) integrated; #3512 adapted (Edit-modal Base URL on fork infra); #3513/#3511 rejected as superseded (fork already fixed via 3542/3537). Merged a142fe259, gate green 2182 pass / 64 known-fail / 0 unexpected, pushed 50cbdba92.
- 63 of ~827 upstream open PRs processed (52 integrated, 8 adapted, 3 rejected).

### 2026-08-28 — session 2 continued: tick 6 complete
- Batch 10: #3509 adapted (muse responses-api; upstream hunk had dropped the cloudflare-ai flattenContent rule — caught by test, restored), #3507 (token-saver observability), #3506 (assistant prefill policy), #3504 (opencode reasoning_effort). Merged 00ea418d5, gate green 2246 pass / 64 known-fail / 0 unexpected, pushed.
- One workflow agent died on a provider 520 (Z.AI) mid-run after committing; worktree inspected, completed, validated manually.
- 67 of ~827 upstream open PRs processed (56 integrated, 9 adapted, 3 rejected... recheck: 58+9=67).

### 2026-08-28 — session 2 continued: tick 7, batch 11 part A
- #3487 (combo token limits), #3482 (DeepSeek Vision, formerly-KNOWN-BUG test flips green), #3485 (pxpipe opt-out + LOCAL_ONLY) integrated/adapted and merged 8ee0ccead. #3494 (Headroom proxy hardening + PXPIPE UI, loopback exception preserved) + #3483 (Ox Alpha caps via fork's opencode format) merged via agents, gate green 2290/64, pushed 5789e66a0.
- Remaining in batch: #3493 (headroom hardening, heavy adapt — supersedes 3507's phantom-warn design), #3492? no. Next: 3493.
- 72 of ~827 upstream open PRs processed (61 integrated, 11 adapted, 3 rejected).

### 2026-08-28 — session 2 continued: tick 7 complete (batch 11 done)
- #3493 (headroom hardening, heaviest adapt) merged ba7477d8e after finishing a 429-killed agent's work inline: reworded a test title tripping the secret-scan, made headroom-detect test platform-neutral (upstream assumed Windows separators), full gate green 2351 pass / 64 known / 0 unexpected. Pushed 86b1a5c5a.
- All 6 batch-11 PRs processed. 73 of ~827 upstream open PRs processed (62 integrated, 11 adapted, 3 rejected).

### 2026-08-28 — session 2 continued: tick 8 complete (batch 12)
- #3465 (empty-content fallback + Responses translation), #3481 (usage breakdown + pricing refresh + canonicalizeUsage adaptation), #3478 (Ollama think), #3476 (CommandCode error peek), #3471 (filter persistence) all integrated. Merged b74251aee, gate green 2376 pass / 64 known / 0 unexpected, pushed d0ce5c155.
- Catch: upstream PR 3465's commit chain was ALSO inside PR 3481's branch (both cherry-picked the same chain); merged 3465 first, deduped the resulting duplicate test block + a leftover ||||||| base marker.
- 78 of ~827 upstream open PRs processed (67 integrated, 11 adapted, 3 rejected).

### 2026-08-29 — session 2 continued: tick 9 complete (batch 13)
- #3460 (Devin Cloud provider, 13 upstream commits + adaptation), #3452 (project-id fail-fast) integrated; #3457 (SSE keepalive) adapted post-transform so the translator never sees ping frames; #3453 (personal Telegram bot + Fly stack) rejected; #3451/#3447 (Ox Alpha duplicates) rejected as superseded by #3483. Merged 0d756c8de, gate green, pushed a9b63b429/f96a7b51c.
- Stale providers baseline re-snapshotted (ollama/ollama-local/opencode thinkingFormat rows from the 3478 merge).
- 84 of ~827 upstream open PRs processed (70 integrated, 12 adapted, 6 rejected).

### 2026-08-29 — session 2 continued: tick 10 complete (batch 14)
- #3433 (Responses usage preservation), #3426 (usage summary details) integrated; #3429 (combo-only exposure, lazy adaptation preserving fork combo enrichment), #3423 (Qwen3.8/Muse pricing+caps, fork muse format kept) adapted; #3428 rejected (superseded by 3528 streamMode); #3445 adapted (non-routing core only — routing stays with fork's upstreamRoute regex). Merged 06893d62f, gate green 2420 pass / 64 known / 0 unexpected, pushed eb4f43060.
- 90 of ~829 upstream open PRs processed (76 integrated, 15 adapted, 7 rejected).

### 2026-08-29 — session 2 continued: tick 11, batch 15 (doubled throughput start)
- Batch 15: #3421 (kimi forceStream + guarded stream sync — fork variant supersedes upstream's unconditional lines), #3420 (stream sync via 3421), #3415 (antigravity hot-reload adapted), #3411 (Gemini function-response schema sanitization), #3408 (commandcode suffix strip) all merged c8f256c67, gate green 2424/64/0, pushed 76820cf07.
- Batch 16 analysis complete (3397/3388/3387 integrate, 3394/3403 adapt); implement workflow running in parallel.
- 95 of ~829 upstream open PRs processed (81 integrated, 14 adapted, 7 rejected).

### 2026-08-29 — session 2 continued: tick 12 complete (batch 16, doubled throughput)
- Batch 16: #3397 (nvidia EOL), #3388 (usage realtime), #3387 (envelope unwrap) integrated; #3394 (resetsAtMs parsing, upstream TypeError fixed + 30-day uncapped rules dropped), #3403 (reliability set, per-hunk adapt) adapted. Merged 78cf1d20f, gate green 2453 pass / 63 known / 0 unexpected (one known-fail healed), pushed 3699036c0.
- Doubled throughput delivered: batches 15+16 (10 PRs) processed in one tick via two parallel implement workflows.
- 100 of ~829 upstream open PRs processed (86 integrated, 16 adapted, 7 rejected).

### 2026-08-29 — session 2 continued: tick 13 complete (batch 17, 10 PRs doubled)
- Group A: #3369 (id-less tool result pairing), #3373 (customToolNames Set normalization), #3380 (OIDC-only mode), #3381 (DB owner-only perms + fork sqljs 0600 persist), #3386 (codex 413 via fork pass mechanism). Group B: #3368 (CLI heap flags), #3367 (Cursor quota), #3366 (antigravity empty parts), #3364 (custom prefixes win), #3363 (Nous provider, p123 + fetchWithTimeout probe). Merged f66afbb78, gate green 2529 pass / 63 known / 0 unexpected, pushed.
- 110 of ~830 upstream open PRs processed (96 integrated, 18 adapted, 7 rejected).

## Verification commands
- `node scripts/tracking/sync-upstream.mjs --check`
- `cd tests && npx vitest run --reporter=json --outputFile=/tmp/vitest-results.json` then `node __baseline__/verify-no-regression.mjs /tmp/vitest-results.json`

### 2026-08-29 — session 2 continued: tick 14 (batch 18)

Batch 18 complete: 9 PRs integrated, 1 skipped, all merged to master through 770ba4a12.

- PR #3376 skipped: fork's providerNodes system (multi/custom-embedding types, prefix-wins routing post-3607) already implements the job; PR adds a parallel plugin system colliding at migration 002/SCHEMA_VERSION/prefix levels.
- Group A: 3361 (codex typed Responses prompts), 3359 (antigravity Hermes sanitization), 3357 (codebuddy-intl caller prompts), 3352 (configurable 429 backoff, defaults unchanged).
- Group B subsets: 3350 (kiro reasoning text + 3 small fixes; GapGPT skipped), 3349 (id-ID README sync, docs-only), 3348 (stream error-path usage finalization routed through fork's finishStream guard), 3347 (bare-name model resolution + canonicalEchoModel + requestedModel attribution), 3346 (invalid-model-id pass rule, Cloudflare/OpenCode-Go usage handlers, Ark GLM cap, combo prefill; commandcode/models-dev/requestLogger skipped).
- Group B workflow lost 6 agent attempts to provider 429s (z-ai/glm-5.3-flash rate limit); all 5 agents recovered on retry, work verified on branches. Recovery workflow for 3348/3347 launched after a stale read, then stopped once the original completion notification arrived.
- Worktree/base anomalies fixed before merge: upstream-pr-3349 and upstream-pr-3350 branches were based on upstream tip 90b52e06f instead of fork master; rebuilt on 3922ed66f via cherry-pick (8815f5a37, 3ccf3a873/003fa6f0c/9d7bdfc2c). 3348 worktree had uncommitted duplicate of committed work; reset to ad283c428.
- Merge conflict in errorConfig.js (3346 pass-rule + 3352 backoff touching the same block) resolved taking the 3352 side; node --check + gate verified.
- Gate: full vitest 2580 pass / 63 fail (all known-fails baseline); verify-no-regression clean. First-run 4 flagged (multi-compatible-provider-nodes, usage-dispatch, xai-oauth-service x2) reproduce pass in isolation, parallel-run flake.

### 2026-08-29 — session 2 continued: tick 15 (first-pass triage + docs batch)

- Full first-pass triage of all 714 open PRs (tracking/first-pass-triage.json, commit 6eed0f631): two waves, 9 subsystem sweeps, rg-verified verdicts. Final: 179 superseded, 43 skip, 165 integrate, 254 adapt, 67 needs-full-analysis, 6 late additions routed to full analysis.
- 222 superseded/skip PRs closed in tracking (commit 9da3bb444), all 222 applied cleanly, sync --check OK, open=492 closed=339. 6 PRs triaged in both waves reconciled (superseded-high wins).
- Docs batch merged (da7008643): PR 2837 Zoo Code branding, 1161 loopback docker bindings (23 files, security), 2812 video reorder. Gate v3 green (2580/63, no regression); v1/v2 reds were parallel-run flake plus one wrong-cwd rerun (ran from repo root, 66 bogus file fails).
- Remaining open: 489 PRs (165 integrate, 254 adapt, 67 needs-full-analysis, plus float). Next: implement batches over the integrate queue; adapt queue needs per-PR fork-delta reconciliation.

### 2026-08-29 — session 2 continued: tick 16 (batch 19, 20 PRs)

- Batch 19 complete: all 20 integrate-queue PRs merged through 02dc03530, gate green (2659 pass / 63 known fails), pushed through c27aa61ef.
- Tranche 1 (12): 3618 GLM caps, 3616 chat rate limit, 3342 codebuddy gate env, 3332 deepseek formats, 3331 Qoder 403/112, 3330 noauth session id, 3311 xiaomi region test, 3310 xiaomi caps + tool args, 3284 lians plugin, 3265 ZDR toggle, 3254 empty tool_calls, 3252 curated model list.
- Tranche 2 (6): 3328 brand icons, 3317 openclaude, 3316 codex TIER log, 3314 sqlite postinstall, 3231 qoder cmodel, 3219 error detail 2000.
- Final (2): 3211 Novita provider (baselines regenerated), 3206 loopback API-only listener.
- Ops note: 6-agent wave limit silently truncates 10-agent parallel batches; fixed by splitting into 6+2 waves. z-ai 429s retried by the workflow runtime without loss.
- Integrate queue: 145 remaining. Next: continue integrate batches by age.

### 2026-08-29 — session 2 continued: tick 17 (batch 20, 12 PRs)

- Batch 20: 12 integrate PRs merged through 6756afe2a, gate 2701 pass / 63 known fails, pushed 383fb29f2.
- Notable: 3174 tool-call id normalization + luna effort=none (cherry-picks + 2 fork-shape fixes), 3179 centralized shutdown flusher registry, 3124 Meta AI registry, 3087/3066 headroom lossless + body-size gate (conflict resolution kept fork's kompress default-on), 3137 vertex RSA key validation.
- Test fix: shutdown-flushers.test.js used path.resolve("src/...") which resolves under tests/ at runtime; fixed to ../src (e5720f3f4).
- Integrate queue: ~133 remaining. Next batches continue by age.

### 2026-08-29 — session 2 continued: tick 18 (batch 21, 12 PRs)

- Batch 21: 12 integrate PRs merged through 1e143a476, gate 2731 pass / 63 known fails, pushed 9bbee1408.
- Regression caught + fixed: PR 3057 (opencode-zen) duplicated opencode-go catalog ids, making bare deepseek-v4-flash-free ownerless (fell through to openrouter prefix rule). Fix 01ee90dff: resolveBareModelStaticOwner falls back to first registry declaration instead of null when no alias prefix matches.
- Fork deltas kept: 3042 max_tokens:1024 probe (PR's 64 regresses #3010), 2997 bypass-agent rewrite skipped (fork SNI-pinned), 2972 one-liner only.
- Integrate queue: ~121 remaining.
