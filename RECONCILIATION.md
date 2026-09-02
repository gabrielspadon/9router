# TokenProxy Reconciliation

Status as of 2026-09-02. This is an audit and replay plan. It changes no runtime behavior.

## Executive Decision

TokenProxy becomes the only request and data plane between the harness edge and upstream providers. The migration must replay behavior, not copy the predecessor integration wholesale.

Most accepted predecessor functionality is already present because TokenProxy begins from the predecessor release at `90b52e06`. Eight additional branch families were checked individually. Seven are already present or have an adapted TokenProxy port. One OpenCode effort correction remains partial.

The unfinished `ai-dotfiles` resilience tree contains valuable behavior, but it mixes two ownership domains. Provider selection, account admission, durable affinity, protocol fidelity, streaming, accounting, qualification, and operational receipts belong in TokenProxy. Launchers, lane choice, model roles, workflow batching, nested-agent policy, host admission, and generated harness configuration remain in `ai-dotfiles`.

The target has no permanent third gateway.

```text
Claude Code   Codex   OpenCode   Kimi   Hermes
     \          |        |        |       /
      +---------+--------+--------+------+
                         |
                         v
        ai-dotfiles edge integration
        launch, lanes, workflow policy,
        loopback credential projection
                         |
                         v
                  TokenProxy :20128
        account selection, request queues,
        translation, streaming, usage, health
                         |
                         v
             provider accounts and APIs
```

Compatibility wrappers may survive one cutover window, but they must call TokenProxy. They must not retain a second account selector, retry engine, model catalog, stream transformer, or usage ledger.

## Evidence Snapshot

The audit is pinned so concurrent work cannot change its meaning.

| Surface | Audited state | Notes |
|---|---|---|
| TokenProxy | `32f680ba43441772787de5c3d1349aa32dc98cbd` | Committed `main` at audit time. All concurrent worktree edits were excluded. |
| Fork point | `90b52e06ffd666b7929554211474d01588f6b1f8` | Last predecessor release reachable from TokenProxy history. |
| TokenProxy initialization | `f6bb8f79` | Branded fork commit whose actual parent is `90b52e06`. |
| Predecessor checkout | `4900b04f` | Read-only branch-family evidence. |
| Published harness edge | `fa21bbbe` | Current `ai-dotfiles` `origin/main` observed during the audit. |
| Resilience overlay | `dee0c13b` | Dirty, unpublished, 22 commits behind the observed harness main, with 69 modifications and one deletion. |
| Concurrent harness overlay | `7aea2ee5` plus unstaged files | Thirteen predecessor integration edits and one temporary TokenProxy session-state mirror. Evidence only. |

Evidence came from Git objects, source inspection, and existing tests. No provider request, paid-account probe, deployment, service restart, database mutation, or runtime implementation was performed.

To preserve the repository residual-name gate, this document calls the retired project the predecessor. In external path references, `<legacy>` stands for the retired package name.

## Ownership Boundary

| Concern | Owner | Boundary rule |
|---|---|---|
| Client launch and environment projection | `ai-dotfiles` | Select the TokenProxy URL and inject one loopback client credential. |
| Lane and model-role policy | `ai-dotfiles` | Preserve default, priority, and ultrafast choices. Choose retrieval, implementation, and judgment roles before the request reaches the gateway. |
| Workflow planning | `ai-dotfiles` | Count active children, not the workflow's declared lifetime total. Batch dynamically and allow nested agents under the harness safety policy. |
| Host-level agent admission | `ai-dotfiles` | Protect host resources and fairness across sessions. Never pre-reserve every logical child a workflow might later create. |
| Provider and account selection | TokenProxy | Normalize quota evidence, rank eligible accounts, hold affinity, and repin atomically. |
| HTTP request admission | TokenProxy | Reserve capacity for the selected account for the full request lifetime. Queue with cancellation and fairness instead of returning an immediate local 503. |
| Translation and provider execution | TokenProxy | Own request formats, provider executors, retry classification, and exact service-tier forwarding. |
| Streaming and terminal truth | TokenProxy | Own heartbeats, stall detection, disconnect handling, usage-only terminals, and completion receipts. |
| Usage, cost, and cache accounting | TokenProxy | Persist canonical per-request and per-account facts. Export aggregates without losing cache writes. |
| Qualification and health | TokenProxy | Expose credential-safe connection, model, and generation evidence through a native admin ABI. |
| Activation, draining, and rollback command | `ai-dotfiles` | Thin operator wrappers call the TokenProxy admin ABI. TokenProxy owns the state transition. |

## Capability Matrix

Priority means migration urgency. `P0` blocks removal of the predecessor integration, `P1` is required for behavioral parity, and `P2` improves resilience after cutover.

| Priority | Capability | TokenProxy status | Evidence | Decision |
|---|---|---|---|---|
| P0 | Compound quota account ordering | Partial | `src/shared/utils/quotaPause.js:50` evaluates windows, but `src/sse/services/auth.js:222` only removes paused accounts and `src/sse/services/auth.js:272` then uses round-robin or static fill-first. | Implement natively. Port the behavior, not the shell implementation, from the resilience overlay's `configure-<legacy>.sh:199-348`. |
| P0 | Account-scoped request admission | Absent | `src/sse/services/auth.js:123` serializes credential selection only and releases at line 371. `src/sse/handlers/chat.js:354` applies a provider-wide cap and refuses at line 375. | Add an atomic select-and-reserve operation whose lease spans the request. Use per-account configurable capacity and a fair cancellable queue. |
| P0 | Durable client-session affinity | Absent | `open-sse/utils/sessionManager.js:14` is process-local and deliberately changes identity after restart. `src/sse/handlers/chat.js:486` pins only combos or same-request retries. | Persist client-session to account affinity with TTL, cache-aware stickiness, atomic repin, and restart recovery. |
| P0 | Native connection qualification | Absent | Qualification, generation evidence, activation, and drain truth remain in `ai-dotfiles/services/<legacy>/`. | Add a small TokenProxy admin surface. Delete the duplicate gateway only after the edge consumes it. |
| P0 | Harness cutover contract | Adapter-owned and unfinished | The resilience overlay still has all G0-G10 evidence pending and conflicts with newer harness main. | Rebase the policy deliberately, retarget only thin adapters, and run end-to-end cutover tests before uninstalling the predecessor. |
| P1 | Codex service-tier fidelity | Partial | `open-sse/config/codexFastMode.js:31` can inject a tier, but `open-sse/executors/codex.js:737` maps `fast` to `priority` and deletes every other value. | Preserve explicit `default`, `priority`, and `ultrafast` exactly. Treat `fast` only as a compatibility alias. Record the outbound tier in a redacted receipt. |
| P1 | Cache-write accounting | Partial | `open-sse/utils/usageTracking.js:220` recognizes selected cache-creation fields. `open-sse/translator/concerns/usage.js:109` exports cached reads only. No reader handles the common `cache_write_tokens` spelling. | Normalize read and write aliases once, then carry both through request, account, daily, and cost aggregates. |
| P1 | Continuous SSE liveness | Partial | `open-sse/utils/streamHandler.js:598` emits heartbeats only before the first upstream chunk. `tests/unit/sse-keepalive.test.js:72` requires them to stop after first data. | Keep downstream heartbeats active during every silent interval. Keep upstream stall detection independent and never treat a heartbeat as provider progress. |
| P1 | Retry and backpressure truth | Partial | Provider fallback exists, but the local provider-wide concurrency check can return 503 before any account reservation. The resilience overlay adds 180-second admission and `Retry-After` behavior in `auth-proxy.mjs:1085` and `:3109`. | Queue locally, preserve caller cancellation, and emit 429 or 503 with accurate `Retry-After` only when a request cannot safely wait or fail over. |
| P1 | Operational redaction | Partial | `open-sse/utils/requestLogger.js:72` masks headers but persists full bodies. `src/lib/db/repos/requestDetailsRepo.js:123` sanitizes request headers while lines 176-179 retain request and provider bodies. | Make body capture opt-in, bounded by retention, field-redacted before persistence, and disabled for secrets and validation frames. |
| P1 | OpenCode reasoning effort scope | Partial | Core effort forwarding is present, but `open-sse/providers/thinkingLevels.js:124` retains broad provider precedence that predecessor correction `fe41dec32` narrowed to `oc/` routes. | Reconcile manually against current provider-level behavior. Do not cherry-pick the old file. |
| P1 | Runtime patch parity | Unproven | The resilience overlay deletes a 385-line byte patch while moving to the native predecessor release. | Prove native parity for max effort, cache controls, cache and cost truth, tool-fragment normalization, usage-only termination, exact account pins, deterministic 4xx handling, provider metadata, generation IDs, and bundled-log removal. Do not recreate byte patching. |
| P2 | Hot-reload repin | Absent as a general contract | The resilience overlay adds route-wide account repin in `provider-pool.mjs:644` and `:1058`. | Fold this into the durable affinity transaction and native admin ABI. |
| P2 | Model availability evidence | Partial | TokenProxy has provider tests and model catalogs, but no slim generation receipt proving the selected connection and terminal outcome for harness consumption. | Expose credential-safe qualification state and per-generation receipts. Keep lane choice at the edge. |
| P2 | Dynamic workflow batching | Adapter-owned | The resilience overlay proposes eight active children, five semantic waves, depth five, nested spawning, and three transient retries. | Keep these as harness defaults and safety ceilings, not a fixed task size and not TokenProxy account limits. The model may use fewer agents or more logical waves within the reviewed runaway ceiling. |

## Account Scheduling Contract

The current static priority and round-robin strategies do not implement the desired account-maxing behavior. The native scheduler should use the following contract.

1. Normalize every provider's general-use quota evidence into window records containing `scope`, `remaining`, `limit`, `resetAt`, `observedAt`, and `confidence`. Five-hour, seven-day, thirty-day, and future windows use the same type. Providers may omit windows they do not have.
2. An account is eligible only when every known hard window has usable headroom and the credential is healthy. Unknown evidence must not outrank fresh known evidence, but it must not take the whole provider offline.
3. Rank eligible accounts by expiring usable entitlement across all applicable windows. A sooner reset receives more urgency, while a constraining longer window prevents a short window from overspending it. Use deterministic account priority only as a tie-breaker.
4. Pin a client session to the selected account. Do not round-robin between healthy accounts. Keep the pin until the account becomes unavailable, a higher-priority account's quota resets, the operator drains it, or a model-specific failure requires repin.
5. When the first account exhausts a binding window, move to the next eligible account. If an earlier account resets while a later account is active, atomically return to the earliest restored account. Never spray one session across all accounts to increase instantaneous throughput.
6. Keep selection and reservation in one transaction. Concurrent requests must not all observe the same final slot and over-admit it.
7. Make capacity configurable per connection. A high-capacity account may accept dozens of concurrent requests while another accepts only a few. Provider-wide policy remains an optional outer safety ceiling, not the only gate.
8. Persist the reason for every switch without storing credentials or prompt bodies. Required fields include old and new connection IDs, normalized quota windows, trigger, model, session hash, and timestamp.

The scheduler should optimize paid entitlement without pretending provider capacity is unlimited. Stability comes from affinity, queues, backpressure, and evidence-driven failover, not from removing every safety bound.

## Workflow Contract

Workflow size and live provider concurrency are different quantities.

- A workflow may describe 20, 120, 180, or more logical agents without reserving all of them at admission time.
- Only currently active children consume host admission and gateway capacity.
- Eight active children per workflow and five semantic waves are reasonable current defaults, not requirements to fill every wave and not a lifetime total of 40.
- Retrieval may use a low-cost lane, implementation a general lane, and architecture or adversarial judgment a high-reasoning lane. This remains model and harness policy.
- Nested agents are allowed within the reviewed depth and runaway ceilings. Every nested call still passes normal lane, credential, and host-resource checks.
- Retry only classified transient child failures with preserved workspace state. Authentication, payment, policy, schema, affinity, and permission failures are terminal until their cause changes.
- Fairness is enforced over active work. One large workflow cannot reserve the host against other sessions merely because its plan names many future agents.

The resilience overlay encodes `80/80/8/400/depth-5/5-waves/nested/retry-3` across the registry, schema, admission code, and tests. Those coupled constants must be reconciled atomically after rebasing. They are candidate policy, not proof that the current tree is deployable. Its `plain_router.max_concurrency` is `2`, while concurrent main work set a different value, so neither value should be carried blindly.

## Branch Family Reconciliation

| Family | Predecessor evidence | TokenProxy evidence | Result |
|---|---|---|---|
| Azure reasoning token precedence | `c2f844af`, `88df4f431`, equivalent tip `b5e96f9e` | Source and test behavior are already present from `f6bb8f79`. | Present. No replay. |
| Generic rate-limit reset parsing | `31331c0c`, finalized by `e46b7b09` and `e0d70548` | `open-sse/utils/error.js:84`, `:237`, `:287` and `open-sse/config/errorConfig.js:78` form a superset. | Present. No replay. |
| OpenCode effort forwarding | `d2be4668`, scope correction `fe41dec32` | Forwarding exists, but the narrowing correction is not fully represented. | Partial. Manual reconciliation only. |
| Crof visual fixtures | `3ad5b20a` | Fixture blob and URL/header snapshots are byte-identical. | Present. No replay. |
| ZenMux Free | `b124e91f` | Adapted ports `65fb36c5` and `f8c05c7d` cover provider, executor, and baseline. | Present. No replay. |
| Sessions UI | `6b8ef0c8` | Adapted port `cce8f00b` covers the tab, persistence, and SSE projection. | Present. No replay. |
| Saved endpoint UI | `c8388df0`, `a84b4fc4`, hardened through `56da1b75` | Safe storage, last-custom recovery, save, select, delete, and tests are present. | Present. No replay. |
| CLI port ownership | `b6711782` | Branded port `dc55bf28` covers fail-closed ownership and four test cases. | Present. No replay. |

This matrix rules out a bulk branch replay. Cherry-picking old commits would overwrite newer registry, database, provider, and UI work while adding almost no missing behavior.

## Thin Integration Replay

The `ai-dotfiles` migration should be mechanical once TokenProxy exposes the required ABI.

### Keep at the edge

- Canonical lane and task registry, schema, `route.sh`, model-lane validation, agent projections, workflows, and generated host settings.
- Native launch adapters for Claude Code, Codex, OpenCode, Kimi, and Hermes.
- Model-role assignment, effort selection, workflow wave planning, nested delegation policy, host admission, and cross-session fairness.
- Stable operator commands for connect, status, usage, drain, tunnel, install, update, refresh, provision, and qualify during one compatibility window.
- Downstream ZDR health checks and credential projection used by the OceanStack plane synchronizer.

### Move behind TokenProxy

- Catalog and completion ingress, Codex Responses ingress, upstream dispatch, account selection, stream framing, terminal truth, receipts, affinity, evidence, credits, drain state, qualification, activation, rollback state, and release health.
- The resilience overlay's quota-window ranking, account-keyed request gate, cooldowns, admission wait, SSE keepalive, hot-reload repin, service-tier preservation, and retry metadata.
- Gateway boundary tests currently colocated under `services/<legacy>/` and its matching integration-test families.

### Drop after cutover

- The monolithic local auth proxy and its second model catalog.
- Runtime byte patching.
- Duplicate provider selection, quota parsing, retry, stream transformation, usage aggregation, and receipt storage in shell or edge JavaScript.
- The temporary session-state mirror. It exists only to keep one retiring interactive session readable and is not a product feature.
- Legacy-named wrappers after the compatibility window and operator documentation update.

## Replay Plan

### Phase 0. Freeze contracts and repair evidence

1. Convert each P0 and P1 matrix row into a TokenProxy issue with its exact acceptance test.
2. Correct `tracking/tokenproxy-brand-cutover.json`. It claims a parentless root at `8c8220f3`, but `git cat-file -p f6bb8f79` shows parent `90b52e06`. Until corrected, the receipt is not reliable provenance evidence.
3. Rebase or reconstruct the resilience overlay on current `ai-dotfiles` main without carrying unrelated snapshots or concurrent work.
4. Freeze the native admin ABI needed by thin wrappers. Include health, model catalog, connection qualification, quota windows, drain, activation, rollback, and generation receipt queries.
5. Bind admin mutation endpoints to loopback by default and require a scoped operator credential distinct from the inference key. Remote administration must traverse an authenticated tunnel. Specify 401 and 403 behavior with unchanged-state proof.

### Phase 1. Build the account control plane

1. Add normalized quota-window and session-affinity persistence with migrations.
2. Implement deterministic compound quota ranking using a fake clock.
3. Implement atomic select-and-reserve with per-account capacity, cancellation, FIFO fairness, cooldowns, and optional provider ceilings.
4. Hold reservations until stream completion, terminal error, or disconnect cleanup.
5. Implement atomic repin on exhaustion, reset, drain, refresh, and model-specific failure.

### Phase 2. Close protocol and accounting gaps

1. Preserve Codex service tiers exactly and prove the outbound payload for every supported tier.
2. Normalize cache-read and cache-write aliases once and carry them through every aggregate.
3. Continue downstream heartbeats after first byte while keeping translator input and upstream stall clocks clean.
4. Return accurate retry metadata and never translate a local admission refusal into a false provider-capacity claim.
5. Redact before persistence and make full body capture explicit, bounded, and safe.
6. Reconcile the OpenCode effort scope correction against current provider capability logic.

### Phase 3. Replace the duplicate gateway

1. Add native qualification and generation receipts without exposing tokens, raw validation frames, or prompt bodies.
2. Move activation, drain, provider evidence, response truth, and rollback state into TokenProxy.
3. Port behavioral tests from the old gateway. Rewrite them against public or admin contracts rather than private implementation details.
4. Retarget edge launchers and operator commands to TokenProxy, leaving compatibility wrappers thin.
5. Delete the duplicate auth proxy only after every boundary-contract behavior has a native test and an end-to-end receipt.

### Phase 4. Cut over and remove the predecessor

1. Build both TokenProxy artifacts and run the repository's baseline-aware suite.
2. Start an isolated TokenProxy instance with a fresh data directory and fake or explicitly approved credentials.
3. Exercise each harness through the real loopback entrypoint, including default, priority, and ultrafast Codex requests.
4. Run the concurrency, quota-reset, affinity, cache, stream-stall, cancellation, drain, and restart scenarios below.
5. Activate the release and verify live health plus generation receipts while keeping the predecessor installed but drained.
6. Soak concurrent live sessions while measuring local queue time, upstream first-token time, account switches, cache reads and writes, terminal accuracy, and local 5xx count.
7. Execute the rollback drill, verify the prior path, return to TokenProxy, and verify recovery again.
8. Uninstall the predecessor only after the live soak closes and the rollback evidence is stored.

## Acceptance Tests

| Test | Required proof |
|---|---|
| Compound windows | Fake-clock cases for accounts with five-hour plus seven-day, seven-day only, and five-hour plus seven-day plus thirty-day windows select the account with the most urgent expiring usable entitlement without violating any longer window. |
| Sequential depletion | Exhaust account one, then two, then use three. Reset two first and prove repin to two. Reset one next and prove repin to one. |
| Affinity | One client session remains on one healthy account across turns and process restart. No round-robin switch occurs. |
| Atomic admission | Parallel selection at the final slot admits exactly one request. Every reservation is released on success, error, abort, and disconnect. |
| High parallelism | At least 80 concurrent isolated HTTP requests complete or wait under configured account limits without a local admission 503, starvation, leaked lease, or cross-session monopoly. |
| Workflow accounting | A workflow declaring 180 logical agents reserves only its active batch. Another session can acquire capacity while future waves remain unstarted. |
| Nested delegation | A child can spawn an allowed child through normal routing up to the configured depth. A disallowed lane or malformed identity still fails closed. |
| Tier fidelity | Captured outbound Codex requests preserve `default`, `priority`, and `ultrafast` byte-for-byte. The audit receipt records the chosen tier. |
| Cache truth | Provider aliases for cache reads and writes produce identical canonical request, account, daily, and cost totals. Account switching is visible beside cache loss. |
| Pre-TTFT silence | Downstream heartbeats keep the client connection alive while the upstream has not produced data. The TTFT watchdog still fires at its deadline. |
| Mid-stream silence | Heartbeats continue after real data, never enter the translator, and never reset the upstream stall timer. No duplicate failover occurs after committed output. |
| Retry metadata | Queue timeout and retryable provider failures return the correct status and `Retry-After`. Authentication, payment, and policy failures are not retried. |
| Privacy | Secret fixtures placed in headers, request bodies, provider bodies, stream frames, and receipts are absent from persisted logs and APIs. |
| Admin authorization | Inference keys cannot call state-changing admin endpoints. Missing, invalid, and insufficient operator credentials return 401 or 403 and leave quota, drain, activation, and rollback state byte-identical. |
| Restart and drain | Existing streams finish during drain, new work stops entering the drained release, affinity survives restart, and rollback restores the prior healthy release. |
| Harness cutover | Claude Code, Codex, OpenCode, Kimi, and Hermes each traverse the thin edge into TokenProxy and receive a terminally valid response from an isolated fake provider. |

Live paid-provider probes are outside the automatic suite. They require an explicit operator choice of account and tier. A green fake-provider test does not prove upstream capacity, and an upstream capacity warning does not prove a local routing defect.

## Exclusions

- No runtime fix, provider request, service deployment, uninstall, or account mutation is part of this document.
- No predecessor branch is merged or cherry-picked wholesale.
- No credential database, session token, usage database, or provider body is copied from the predecessor.
- No model-lane policy, workflow planner, or host agent broker moves into TokenProxy.
- No fixed account rotation is introduced. Affinity and reset-aware repin replace round-robin spreading.
- No promise of physically unlimited concurrency is made. The target is no arbitrary local rejection, fair queuing, explicit account capacity, and graceful provider backpressure.
- No concurrent README, provider documentation, `ai-dotfiles`, or resilience-tree change is included in the reconciliation commit.

## Completion Criteria

The migration is complete only when all P0 and P1 rows have executable acceptance evidence, the duplicate gateway is gone, every harness uses the TokenProxy entrypoint, service tiers remain distinguishable, account switches follow normalized reset evidence, cache read and write totals survive aggregation, concurrent workflows share capacity fairly, and live activation plus rollback are both verified.

Until then, TokenProxy is the correct destination but not yet a proven behavioral replacement for the full local integration.
