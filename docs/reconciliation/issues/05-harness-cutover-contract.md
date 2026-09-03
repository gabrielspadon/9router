# Harness cutover contract

Priority: P0
Status: Adapter-owned and unfinished

## Current behavior

- The unfinished resilience overlay lives entirely in `ai-dotfiles`, not in this repository, so there is no TokenProxy `file:line` to re-verify for the overlay itself. The Evidence Snapshot pins it at `dee0c13b`: dirty, unpublished, 22 commits behind the observed harness `main` at `fa21bbbe`, with 69 modifications and one deletion, and "all G0-G10 evidence pending" per the matrix.
- On the TokenProxy side, what exists today is the admin/inference boundary rows 04's file documents (`src/dashboardGuard.js`, wired at `src/proxy.js:2`) and the account-selection/admission primitives rows 01-03 build out. There is no TokenProxy-side "harness cutover test" today, because there is no admin ABI yet for a thin edge adapter to call.
- `src/sse/handlers/chat.js` already routes Codex, and the model catalog already spans multiple providers (per the Branch Family Reconciliation table's "Present, no replay" rows), so the *transport* a cutover test would exercise exists; what does not exist is a documented, versioned contract for "isolated fake provider returns a terminally valid response" that all five harnesses can be pointed at in a test.

## Required behavior

Per the Ownership Boundary and Thin Integration Replay sections: TokenProxy owns provider/account selection, HTTP admission, translation and execution, streaming, accounting, and qualification/health (rows 01-04, 06-12 of this matrix); `ai-dotfiles` owns launch, lane/model-role policy, workflow planning, and host-level agent admission, and stays a thin adapter once TokenProxy exposes the frozen admin ABI (Phase 0, step 4: health, model catalog, connection qualification, quota windows, drain, activation, rollback, and generation receipt queries).

The cutover contract this row tracks is: once that ABI is frozen, the resilience overlay is rebased or reconstructed on current `ai-dotfiles` main (not cherry-picked wholesale — the Branch Family Reconciliation table shows wholesale replay would overwrite newer registry, database, provider, and UI work), and only thin adapters are retargeted at TokenProxy's loopback URL. End-to-end cutover tests run before the predecessor is uninstalled.

Failure direction: until the admin ABI is frozen and the overlay is rebased, no harness launcher is repointed at TokenProxy for anything beyond what already works today (rows already "Present" in the Branch Family table). A harness whose thin adapter cannot reach TokenProxy's loopback URL fails closed to "cannot start this session" — it must not silently fall back to a second, duplicate selector or catalog, which is exactly the "compatibility wrapper retains a second account selector" pattern the Executive Decision section forbids.

## Acceptance test

Required proof (Acceptance Tests, "Harness cutover"): "Claude Code, Codex, OpenCode, Kimi, and Hermes each traverse the thin edge into TokenProxy and receive a terminally valid response from an isolated fake provider."

Vitest translation (TokenProxy side only — the `ai-dotfiles` launcher/adapter half of this test lives outside this repository and is not part of this issue's blast radius):

- Fixture: one isolated fake provider executor registered under TokenProxy's normal executor registry, returning a fixed, terminally valid response (a complete non-streaming chat completion, or a short SSE stream that ends in a real `[DONE]`/completion event) with no network call.
- For each of the five harness-shaped request bodies (Claude Code's Anthropic-style shape, Codex's Responses-API shape, OpenCode's and Kimi's OpenAI-chat shape, Hermes' shape — the exact bodies already exist as fixtures for the "Present, no replay" branch-family tests and are reused here rather than re-authored), POST through the same handler entry point (`src/sse/handlers/chat.js`'s exported handler) with the fake provider selected.
- Assert each response is terminally valid for its shape: a `finish_reason`/`stop_reason` that is not an error code, well-formed usage totals, and — for the streaming shapes — a terminal SSE event rather than a silently truncated stream.
- Assert none of the five paths touches the admin ABI's mutation endpoints (qualification/drain/activation stay untouched by a plain inference request) — a spy on the row 04 admin service asserting zero calls.
- Proposed file: `tests/unit/reconciliation/harness-cutover-contract.test.js`.

## Blast radius

- No source change on the TokenProxy side beyond what rows 01-04 and 06-12 already introduce; this row's own deliverable is the frozen admin ABI (row 04) plus the fake-provider fixture set reused across all five per-harness cases above.
- New fixture module (e.g. `tests/fixtures/harness-request-shapes.js`) holding the five per-harness request bodies, if not already present under `tests/unit/executors/`.
- `tests/unit/reconciliation/harness-cutover-contract.test.js` — new.
- Everything on the `ai-dotfiles` side (launch adapters, lane policy, generated host settings) is explicitly out of this repository's blast radius per the Ownership Boundary table and the task's own scope restriction.

No DB migration. This row is a cross-cutting contract test over capabilities rows 01-04 already add; it introduces no new persisted state of its own.
