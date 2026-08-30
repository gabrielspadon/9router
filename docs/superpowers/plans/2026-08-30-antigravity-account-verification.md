# Antigravity Account Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect authoritative Antigravity account-validation challenges, retain each validated action URL in bounded connection-scoped server memory, and expose an authenticated provider-row action that clears only after an explicit successful recheck or terminally successful request.

**Architecture:** Phase 1 adds a pure Google-contract classifier and threads typed challenge and terminal-success callbacks through the provider engine without app imports. Phase 2 owns bounded ephemeral app state, exhaustive callback wiring, and four route methods behind a dedicated identity and CSRF boundary. Phase 3 adds one page-scoped client transport, a matching connection-row action, and all locale literals. Each phase is one reviewed commit, and no phase writes the URL to persistence, broad state, usage telemetry, logs, or public errors.

**Tech Stack:** ESM JavaScript, Node Web `Request`, `Response`, `ReadableStream`, `AbortController`, `EventEmitter`, Next.js 16 App Router, React 19, Vitest 4, ESLint 9, SQLite online backup for the final isolated probe.

## Global Constraints

- Work only in `/home/spadon/Codebases/9router/.claude/worktrees/task-6-pr3635` on `integration/task6-pr3635`.
- The approved design commit is `9d8193182`. Do not change the design or this plan during implementation.
- Do not merge, cherry-pick, or apply upstream PR #3635. Do not mutate any upstream remote.
- Make exactly three implementation commits, one for each phase. Task 4 is verification-only and makes no commit.
- Use strict TDD. Record each named RED before its production edit and the corresponding GREEN before the phase commit.
- Preserve the official Antigravity IDE Desktop 2.5.5 fingerprint, `buildHeaders`, platform selection, request body construction, image-part behavior, MIME-key translation, timeouts, unsupported-field retry, account fallback, quota hot reload, and account-health callback timing.
- Preserve `getProjectIdForConnection(...): Promise<string|null>` and `getUsageForProvider(...): Promise<object>` as public return contracts.
- The action URL is accepted only from the two structured contracts in the approved design. Hostname alone, message text, a root URL, an appeal field, or a raw regex match is never authority.
- The server URL validator accepts only trimmed control-free HTTPS URLs for exact `accounts.google.com`, default HTTPS port, no credentials, and at most 8,192 UTF-8 bytes before and after canonicalization.
- The raw URL appears only in the module-private live entry and the authenticated detail response. It never appears in usage data, usage SSE, request details, request logs, public error JSON, process globals, broad events, redirects, or localization telemetry.
- State policy is exact. TTL is 10 minutes, live-entry cap is 256, idempotency-ledger cap is 1,024 pairs, and the cleanup interval is 1 minute. Timers are unreferenced.
- Every upstream operation snapshots the current challenge before it begins. Only compare-and-clear using that snapshot may remove state after success.
- Chat success for verification is terminal. A first valid stream event still clears account health but never clears verification.
- Sensitive-route identity and mutation CSRF checks are route-local. Middleware is only an outer gate.
- Do not modify `src/dashboardGuard.js`, `src/lib/db/repos/usageRepo.js`, `src/lib/usageDb.js`, `src/app/api/usage/stream/route.js`, `src/shared/components/UsageStats.js`, `src/shared/components/layouts/DashboardLayout.js`, database migrations, package manifests, lockfiles, generated registries, or general SSE infrastructure.
- Do not restore `src/sse/services/antigravityQuota.js` or `tests/unit/antigravity-quota-routing.test.js`.
- Do not add permissive CORS, a URL-bearing `Location`, Zustand verification state, database state, `globalThis` state, or a dashboard-wide banner.
- The six English source literals are exact. Brand spelling remains `Antigravity`.
- Do not push, deploy, restart, or kill the live services on ports 20127, 20128, or 20129.

---

## File Map

### Created in Phase 1

- `open-sse/services/antigravityValidation.js` owns pure classification, URL validation, and redaction.
- `tests/unit/antigravity-validation.test.js` contains 48 classifier, URL, and redaction tests.
- `tests/unit/antigravity-project-outcome.test.js` contains 11 typed-outcome, deduplicated-callback, and replacement-safe cleanup tests.
- `tests/unit/antigravity-usage-validation.test.js` contains 12 single-read usage and callback tests.
- `tests/unit/antigravity-retry-response.test.js` contains 6 complete retry-replacement tests.
- `tests/unit/antigravity-terminal-verification.test.js` contains 14 terminal-success tests.

### Modified in Phase 1

- `open-sse/executors/antigravity.js` adds only a redacting `parseError` override and its classifier import.
- `open-sse/services/projectId.js` owns internal `ProjectOutcome`, pending-operation multicast, single-read response parsing, and redacted diagnostics.
- `open-sse/services/usage/google.js` owns Antigravity single-read classification and the usable-quota predicate.
- `open-sse/services/usage.js` threads only explicit trusted connection and hook fields.
- `open-sse/utils/error.js` preserves typed validation metadata internally and leaves public errors URL-free.
- `open-sse/handlers/chatCore.js` owns complete post-refresh state replacement and callback adaptation.
- `open-sse/handlers/chatCore/nonStreamingHandler.js` invokes verification success only after current usable-output validation.
- `open-sse/handlers/chatCore/sseToJsonHandler.js` invokes verification success only after parsed non-empty output.
- `open-sse/handlers/chatCore/streamingHandler.js` invokes verification success only from non-aborted useful terminal completion.
- `tests/unit/chat-connect-timeout-propagation.test.js` changes the obsolete original-401 expectation to the approved retry-transport mapping.

### Created in Phase 2

- `src/lib/antigravityVerification.js` owns the bounded store, URL-free event emitter, invalidatable connection lifetimes, hook factory, and one-attempt usage wrapper.
- `src/lib/auth/antigravityVerificationAccess.js` owns the sensitive route inventory, identity matrix, CSRF gate, and security headers.
- `src/app/api/providers/antigravity/verification/stream/route.js` serves sanitized SSE snapshot and deltas.
- `src/app/api/providers/antigravity/verification/[connectionId]/route.js` serves authenticated detail and compare-dismissal.
- `src/app/api/providers/antigravity/verification/[connectionId]/recheck/route.js` runs one exact-connection forced usage probe.
- `tests/fixtures/antigravity-verification-access.js` owns the shared seven-row identity table and 14-case mutation matrix used by helper and route tests.
- `tests/unit/antigravity-verification-state.test.js` contains 19 bounded-state, connection-lifetime, and race tests.
- `tests/unit/antigravity-verification-access.test.js` contains 28 identity, inventory, and CSRF tests.
- `tests/unit/antigravity-verification-routes.test.js` contains 23 route, header, cleanup, and outcome tests.
- `tests/unit/antigravity-verification-callers.test.js` contains 14 exhaustive caller-wiring and deletion-invalidation tests.
- `tests/unit/antigravity-verification-privacy.test.js` contains 10 URL-exclusion and sink-ordering tests.

### Modified in Phase 2

- `src/sse/handlers/chat.js` adds project and chat operation hook snapshots for Antigravity only.
- `src/sse/services/tokenRefresh.js` adds hooks to the non-blocking Antigravity project refresh.
- `src/sse/services/quotaGuard.js` uses the app usage wrapper while preserving the three-second race and fail-open result.
- `src/app/api/providers/[id]/hotreload/route.js` uses the wrapper for every quota attempt and classifies a direct 403 body once.
- `src/app/api/usage/[connectionId]/route.js` uses a fresh wrapper call for initial, forced, and post-refresh Antigravity usage.
- `src/app/api/providers/[id]/route.js` invalidates the deleted connection lifetime only after connection deletion succeeds.

### Created in Phase 3

- `src/app/(dashboard)/dashboard/providers/[id]/useAntigravityVerification.js` owns the status-visible auth preflight, one page-scoped EventSource, authoritative snapshot reconciliation, authenticated detail fetches, client URL revalidation, expiry, races, and recheck POST.
- `tests/unit/antigravity-verification-client.test.js` contains 16 client transport, authoritative-snapshot, and race tests.
- `tests/unit/antigravity-verification-ui.test.js` contains 8 rendered row, translation, and accessibility tests.
- `tests/unit/antigravity-verification-locales.test.js` contains 3 exact 34-catalog literal tests.

### Modified in Phase 3

- `src/app/(dashboard)/dashboard/providers/[id]/page.js` invokes the hook unconditionally, enables it only for Antigravity, maps state by exact connection ID, and renders one access explanation.
- `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js` renders the required state, anchor, explicit recheck button, and bounded error state while preserving every existing prop and control.
- All 34 JSON files under `public/i18n/literals/` add exactly the six approved English keys with localized values.

## Test Arithmetic

The implementation adds exactly 212 tests.

| Phase | New tests | Measured existing adjacency | Focused GREEN total |
| --- | ---: | ---: | ---: |
| Phase 1 | 91 | 98 | 189 |
| Phase 2 | 94 | 104 | 289, including all 91 Phase 1 tests |
| Phase 3 | 27 | 43 | 255, including all 212 feature tests |

The fork base at plan authoring has 3,498 tests. With 212 new tests and no deleted test, the final full-suite result must report 3,710 total tests. The repository baseline permits the existing 60 known failures and 57 pending tests. Any additional failure is a regression.

## Interfaces

```js
// open-sse/services/antigravityValidation.js
validateAntigravityVerificationUrl(candidate) -> string | null
classifyAntigravityValidation({ status, payload, source })
  -> { kind: "antigravity_validation_required", url: string, source: string } | null
redactAntigravityValidationText(text) -> string

// source is exactly one of these values
"loadCodeAssist" | "onboardUser" | "usage" | "chat"

// open-sse/services/projectId.js
getProjectIdForConnection(connectionId, accessToken, provider = "gemini-cli", hooks = {})
  -> Promise<string | null>

ProjectOutcome =
  | { kind: "project", projectId: string }
  | { kind: "validation_required", validation: object, observationId: string }
  | { kind: "failure" }

VerificationContext = {
  connectionId: string,
  observationId: string,
  challengeIdAtStart: string | null,
}

VerificationHooks = {
  verificationContext: VerificationContext,
  onValidationRequired: ({ validation, observationId }) => void | Promise<void>,
  onVerificationSuccess: ({ challengeId }) => void | Promise<void>,
}

// open-sse/services/usage.js
getUsageForProvider(connection, proxyOptions = null, options = {}) -> Promise<object>

// open-sse/services/usage/google.js
getAntigravityUsage(accessToken, providerSpecificData, proxyOptions = null, hooks = {})
  -> Promise<object>
isUsableAntigravityUsageResult(value) -> boolean
```

Only these `options` fields cross the usage dispatcher.

```js
const usageContext = {
  provider,
  connectionId: connection.id,
  accessToken,
  apiKey,
  providerSpecificData,
  providerDataWithProjectId,
  proxyOptions,
  force: options.force === true,
  verificationContext: options.verificationContext,
  onValidationRequired: options.onValidationRequired,
  onVerificationSuccess: options.onVerificationSuccess,
};
```

No `...options` spread is permitted after trusted fields.

```js
// src/lib/antigravityVerification.js
createAntigravityVerificationHooks(connectionId, expectedChallengeId) -> VerificationHooks
runAntigravityUsageProbe(connection, proxyOptions, { force, expectedChallengeId }) -> Promise<object>
getAntigravityVerificationSnapshot() -> Array<{ connectionId, challengeId, expiresAt }>
getAntigravityVerification(connectionId) -> { connectionId, challengeId, expiresAt, href } | null
recordAntigravityValidation(connectionId, { validation, observationId }, connectionLifetime) -> boolean
clearAntigravityVerificationIfCurrent(connectionId, challengeId, connectionLifetime = undefined) -> boolean
invalidateAntigravityVerificationConnection(connectionId) -> boolean
subscribeAntigravityVerification(listener) -> () => void

// Sanitized emitted values
{ type: "upsert", connectionId, challengeId, expiresAt }
{ type: "remove", connectionId, challengeId }
```

The opaque `connectionLifetime` is module-private and is supplied only by closures returned from `createAntigravityVerificationHooks`. Callback paths always supply it. The token-free `clearAntigravityVerificationIfCurrent` form is reserved for the already-authorized route-local dismissal path. No caller can obtain, serialize, or log a lifetime token.

```js
// src/lib/auth/antigravityVerificationAccess.js
ANTIGRAVITY_VERIFICATION_ROUTE_POLICY = [
  { method: "GET", path: "/api/providers/antigravity/verification/stream", classification: "sensitive-verification" },
  { method: "GET", path: "/api/providers/antigravity/verification/[connectionId]", classification: "sensitive-verification" },
  { method: "DELETE", path: "/api/providers/antigravity/verification/[connectionId]", classification: "sensitive-verification" },
  { method: "POST", path: "/api/providers/antigravity/verification/[connectionId]/recheck", classification: "sensitive-verification" },
]

authorizeAntigravityVerification(request)
  -> Promise<{ ok: true, viaCli: boolean } | { ok: false, response: Response }>
authorizeAntigravityVerificationMutation(request)
  -> Promise<{ ok: true, viaCli: boolean } | { ok: false, response: Response }>
withAntigravityVerificationHeaders(headers = {}) -> Headers
antigravityVerificationJson(body, { status = 200, headers = {} } = {}) -> Response
```

The hook returns only component-safe values.

```js
// src/app/(dashboard)/dashboard/providers/[id]/useAntigravityVerification.js
useAntigravityVerification({ enabled }) -> {
  byConnectionId: Object<string, {
    connectionId: string,
    challengeId: string,
    expiresAt: number,
    href: string | null,
    rechecking: boolean,
    error: string | null,
  }>,
  accessDenied: boolean,
  recheck: (connectionId: string) => Promise<void>,
}
```

## Snapshot and Dependency Stop Rules

The plan commit must be the clean implementation snapshot.

```bash
set -euo pipefail
pr3635_plan_head=$(git log -1 --format=%H -- docs/superpowers/plans/2026-08-30-antigravity-account-verification.md)
test -n "$pr3635_plan_head"
test "$(git rev-parse HEAD)" = "$pr3635_plan_head"
test "$(git log -1 --format=%s)" = "docs(antigravity): fix verification implementation plan"
test -z "$(git status --porcelain)"
```

Stop without stashing, resetting, reverting, or editing if any assertion fails. Dependency provisioning is coordinator-owned because it can change manifests or lockfiles. An implementation worker runs this preflight from the worktree root before any test, lint, or build and stops with exit 2 if it fails.

```bash
set -euo pipefail
if ! test -d node_modules \
  || ! test -x node_modules/.bin/eslint \
  || ! test -x node_modules/.bin/next \
  || ! test -d tests/node_modules \
  || ! test -x tests/node_modules/.bin/vitest; then
  printf '%s\n' 'dependency preflight failed; coordinator provisioning required' >&2
  exit 2
fi
test -z "$(git status --porcelain)"
```

The worker never runs `npm install` or `npm ci`. After an exit 2, the coordinator may provision dependencies in this worktree using the repository-approved immutable install. Before handing control back, the coordinator must re-run the preflight, prove `git diff --exit-code -- package.json package-lock.json`, and prove clean porcelain. Snapshot update mode and baseline generators remain forbidden to both roles.

Before and after every test, lint, and build command, run `git status --short` and compare the paths to the current phase ownership list. Dirty owned RED/GREEN work is expected before its phase commit. At the initial snapshot, after every commit, before Task 4, and after Task 4, assert `test -z "$(git status --porcelain)"`. If a command creates or changes a path not owned by the current phase, stop and report it. Never stage, edit, or reverse generated churn in a worker. Return control to the coordinator if any of these paths change.

Every Bash fence is a fail-fast gate and already begins with `set -euo pipefail`. The default cwd is `/home/spadon/Codebases/9router/.claude/worktrees/task-6-pr3635`; only fences explicitly labeled `tests/` run from `/home/spadon/Codebases/9router/.claude/worktrees/task-6-pr3635/tests`. Run fences separately unless a task explicitly says they share one shell. Do not concatenate unrelated fences. A deliberately expected nonzero program is wrapped with `set +e`, its exit code is captured immediately, and `set -e` is restored before assertions. Every pipeline therefore fails when any leg fails. A forbidden `rg` search uses an explicit inverted `if`, while a required-match `rg` remains a normal positive assertion.

```text
package.json
package-lock.json
tests/__baseline__/alias-baseline.json
tests/__baseline__/baseline-results.json
tests/__baseline__/current.json
tests/__baseline__/known-fails.txt
tests/__baseline__/oauth-urls-baseline.json
tests/__baseline__/providers-baseline.json
tests/qa/regression-baseline.json
tests/translator/__snapshots__/golden-request.test.js.snap
tests/translator/__snapshots__/golden-response-stream.test.js.snap
tests/translator/__snapshots__/golden-translator-concerns.test.js.snap
tests/translator/__snapshots__/golden-url-header.test.js.snap
```

---

## Task 1: Classify authoritative challenges and preserve terminal retry outcomes

**Files:**
- Create: `open-sse/services/antigravityValidation.js`
- Create: `tests/unit/antigravity-validation.test.js`
- Create: `tests/unit/antigravity-project-outcome.test.js`
- Create: `tests/unit/antigravity-usage-validation.test.js`
- Create: `tests/unit/antigravity-retry-response.test.js`
- Create: `tests/unit/antigravity-terminal-verification.test.js`
- Modify: `open-sse/executors/antigravity.js:1-560`
- Modify: `open-sse/services/projectId.js:10-305`
- Modify: `open-sse/services/usage/google.js:1-244`
- Modify: `open-sse/services/usage.js:35-85`
- Modify: `open-sse/utils/error.js:92-175`
- Modify: `open-sse/handlers/chatCore.js:118-1137`
- Modify: `open-sse/handlers/chatCore/nonStreamingHandler.js:389-554`
- Modify: `open-sse/handlers/chatCore/sseToJsonHandler.js:278-520`
- Modify: `open-sse/handlers/chatCore/streamingHandler.js:47-348`
- Modify: `tests/unit/chat-connect-timeout-propagation.test.js:238-281`

**Interfaces:**
- Consumes: the exact classifier, `VerificationContext`, and callback contracts above; current executor results `{ response, url, headers, transformedBody, responseFormat? }`.
- Produces: 91 deterministic feature tests, URL-free typed errors, replacement-safe `ProjectOutcome` multicast, complete retry replacement, and terminal verification success.
- Preserves: public project and usage return values, account-health `onRequestSuccess`, first-valid-event timing, current provider error annotations, and all current transport and fingerprint behavior.

**Step group 1: Record the clean snapshot and Phase 1 baseline**

- [ ] **Step 1a:** Run the snapshot assertions from the worktree root.
- [ ] **Step 1b:** Run the five dependency assertions from the worktree root.
- [ ] **Step 1c:** Run the measured Phase 1 adjacency command from `tests/` and record 98 passed.

Run the snapshot and dependency rules. Then run the measured Phase 1 adjacency command from `tests/`.

```bash
set -euo pipefail
./node_modules/.bin/vitest run \
  unit/gemini-36-integration.test.js \
  unit/antigravity-retry-hook.test.js \
  unit/antigravity-usage-headers.test.js \
  unit/antigravity-image-editing.test.js \
  unit/antigravity-ide-version-sync.test.js \
  unit/chat-connect-timeout-propagation.test.js \
  unit/stream-first-valid-event-gate.test.js \
  unit/streaming-interrupted-detail.test.js \
  unit/adaptive-stripper.test.js \
  unit/account-fallback-rules.test.js
```

Expected result is exactly 98 passed and zero failed. Run from `/home/spadon/Codebases/9router/.claude/worktrees/task-6-pr3635/tests`.

**Step group 2: Write the 48 classifier, validator, and redactor tests**

- [ ] **Step 2a:** Create the three contract-only exports and confirm the test module imports.
- [ ] **Step 2b:** Add the shared domain, URL, ErrorInfo, Help, RPC, and load fixture builders below.
- [ ] **Step 2c:** Add the 6 accepted structured-response cases.
- [ ] **Step 2d:** Add rejected structured-response cases 1 through 6 from the ordered table.
- [ ] **Step 2e:** Add rejected structured-response cases 7 through 12 from the ordered table.
- [ ] **Step 2f:** Add rejected structured-response cases 13 through 18 from the ordered table.
- [ ] **Step 2g:** Add the 3 accepted and first 8 rejected URL cases.
- [ ] **Step 2h:** Add the remaining 8 rejected URL cases.
- [ ] **Step 2i:** Add the 5 redaction cases and assert both URL and query-token absence.

Create the module first with contract-only stubs so Vitest collects every fixture.

```js
export function classifyAntigravityValidation() { return null; }
export function validateAntigravityVerificationUrl() { return null; }
export function redactAntigravityValidationText(text) { return String(text ?? ""); }
```

Use `describe` names `structured contracts`, `URL validation`, and `redaction`; the focused commands below depend on those exact names. Use these authoritative fixture builders in `antigravity-validation.test.js`.

```js
const DOMAINS = [
  "cloudcode-pa.googleapis.com",
  "staging-cloudcode-pa.googleapis.com",
  "autopush-cloudcode-pa.googleapis.com",
];
const URL = "https://accounts.google.com/AccountChooser?token=opaque-secret#step";
const errorInfo = (overrides = {}) => ({
  "@type": "type.googleapis.com/google.rpc.ErrorInfo",
  domain: DOMAINS[0],
  reason: "VALIDATION_REQUIRED",
  metadata: {},
  ...overrides,
});
const help = (links = [{ url: URL }]) => ({
  "@type": "type.googleapis.com/google.rpc.Help",
  links,
});
const rpc = (details, code = 403) => ({ error: { code, message: "validation needed", details } });
const load = (overrides = {}) => ({
  ineligibleTiers: [{ reasonCode: "VALIDATION_REQUIRED", validationUrl: URL }],
  ...overrides,
});

const REALISTIC_VALIDATION_URLS = [
  "https://accounts.google.com/AccountChooser?continue=https%3A%2F%2Fcloudcode-pa.googleapis.com%2Fv1internal%3AloadCodeAssist&flowName=GlifWebSignIn&opaque=project-secret",
  "https://accounts.google.com/v3/signin/challenge/pwd?continue=https%3A%2F%2Fcloudcode-pa.googleapis.com%2Fv1internal%3AonboardUser&flowName=GlifWebSignIn&opaque=onboard-secret",
];
```

The 48-test inventory is exact.

| Group | Count | Exact fixtures |
| --- | ---: | --- |
| Accepted structured responses | 6 | successful `loadCodeAssist`; each of 3 domains; metadata fallback; first Help link beats metadata |
| Rejected structured responses | 18 | wrong source for successful tier; non-success load; `currentTier`; wrong reason; missing URL; root URL; appeal URL; raw text URL; non-403 RPC; mismatched `error.code`; wrong type; wrong domain; wrong reason; whitespace-altered reason; later Help link; invalid first Help candidate with valid metadata; loosely named metadata; missing ErrorInfo |
| Accepted URL forms | 3 | exact HTTPS; explicit `:443` canonicalized; opaque path, query, and fragment retained |
| Rejected URL forms | 16 | non-string; empty; leading space; trailing space; C0; DEL; malformed; HTTP; alternate host; subdomain; trailing dot; username; password; non-default port; overlong UTF-8 input; canonical href expansion over 8,192 bytes |
| Redaction | 5 | each structured key; Help URL; malformed raw account URL; opaque query absent; non-sensitive status text retained |

Every rejection asserts `null`. Every successful classification asserts the exact canonical URL and source. Every redaction assertion scans both the full URL and `opaque-secret`.

**Step group 3: Write the remaining 43 Phase 1 tests**

- [ ] **Step 3a:** Add `onceTextResponse` and trusted-hook fixtures.
- [ ] **Step 3b:** Add the 11 project-outcome cases, including replacement-safe cleanup.
- [ ] **Step 3c:** Add usage cases 1 through 6, including both single-read assertions.
- [ ] **Step 3d:** Add usage cases 7 through 12, including every negative success case.
- [ ] **Step 3e:** Add the 6 complete retry-replacement cases.
- [ ] **Step 3f:** Add terminal cases 1 through 7 for non-stream and forced conversion.
- [ ] **Step 3g:** Add terminal cases 8 through 14 for stream completion and negative terminals.
- [ ] **Step 3h:** Run the exact five-file RED command and record 40 failed plus 51 passed.

Use callback spies that reject independently and response fixtures whose `.text()` throws on a second read.

```js
function onceTextResponse(payload, status = 200) {
  let reads = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    async text() {
      reads += 1;
      if (reads > 1) throw new Error("body read twice");
      return JSON.stringify(payload);
    },
    get reads() { return reads; },
  };
}

function hooks({ observationId = "obs-1", challengeIdAtStart = "challenge-A" } = {}) {
  return {
    verificationContext: { connectionId: "conn-A", observationId, challengeIdAtStart },
    onValidationRequired: vi.fn(),
    onVerificationSuccess: vi.fn(),
  };
}
```

The exact remaining inventory is as follows.

| Test file | Count | Exact behaviors |
| --- | ---: | --- |
| `antigravity-project-outcome.test.js` | 11 | cache hit has no callback; validation reaches initiator; late waiter receives same outcome and observation; throwing waiter isolation; success reaches every waiter; success uses first challenge snapshot; failure has no callbacks; removal abort has no success; different connections are independent; project success still caches; an old pending operation's `finally` cannot delete a replacement entry for the same connection |
| `antigravity-usage-validation.test.js` | 12 | subscription success challenge; subscription 403; quota 403; usable `models` success; subscription single read; quota single read; callback rejection fail-open and redacted; message result no success; subscription-only no success; malformed 2xx no success; HTTP error no success; transport failure no success |
| `antigravity-retry-response.test.js` | 6 | retry success replaces response, URL, headers, body, format, and last target log; retry 403 does the same and classifies retry body; generic retry HTTP error replaces original; typed timeout maps retry; abort maps retry; other transport failure maps retry and never resurrects original 401 |
| `antigravity-terminal-verification.test.js` | 14 | usable non-stream; malformed non-stream; disguised HTTP-200 structured error containing both `REALISTIC_VALIDATION_URLS`; empty non-stream; usable forced SSE-to-JSON; malformed forced conversion; first stream event only account success; terminal text; terminal thinking; terminal output tokens; empty EOF; aborted completion; abandonment; duplicate terminal callback |

The project validation cases embed `REALISTIC_VALIDATION_URLS[0]` in loadCodeAssist and `REALISTIC_VALIDATION_URLS[1]` in onboardUser. Before production edits, their sink assertions are RED. The disguised HTTP-200 fixture uses a strict RPC-shaped body with both real-looking Help links but an HTTP status of 200. It must not classify or clear verification. Both full URLs, both opaque markers, and all query values must be absent from non-stream output, forced SSE-to-JSON output, serialized public responses, captured console calls, and a temporary mocked disk-log sink. Tests write only the sink capture under `/tmp` and remove it in `afterEach`.

Before production edits, run only the five new files from `tests/`.

```bash
set -euo pipefail
./node_modules/.bin/vitest run \
  unit/antigravity-validation.test.js \
  unit/antigravity-project-outcome.test.js \
  unit/antigravity-usage-validation.test.js \
  unit/antigravity-retry-response.test.js \
  unit/antigravity-terminal-verification.test.js
```

Expected RED is exactly 40 failed and 51 passed. The failures are 14 positive classifier or redaction assertions, 9 typed-project assertions, 7 usage callback or single-read assertions, 4 retry-replacement assertions, and 6 positive terminal-success assertions. Negative and preservation cases account for the 51 passes.

**Step group 4: Implement the pure classifier and redactor**

- [ ] **Step 4a:** Implement only `validateAntigravityVerificationUrl` from the exact code below.
- [ ] **Step 4b:** Run `./node_modules/.bin/vitest run unit/antigravity-validation.test.js -t 'URL'` from `tests/` and make only the 19 URL cases GREEN.
- [ ] **Step 4c:** Implement strict source, successful-tier, and RPC classification precedence.
- [ ] **Step 4d:** Run `./node_modules/.bin/vitest run unit/antigravity-validation.test.js -t 'structured'` from `tests/` and make the 24 structured cases GREEN.
- [ ] **Step 4e:** Implement field-aware JSON and malformed-text redaction.
- [ ] **Step 4f:** Run `./node_modules/.bin/vitest run unit/antigravity-validation.test.js` from `tests/` and record 48 passed.

Replace the stubs with a side-effect-free module. It may import only Node-free language primitives. Use `TextEncoder` for both length checks and return canonical `URL.href`.

```js
const ERROR_INFO = "type.googleapis.com/google.rpc.ErrorInfo";
const HELP = "type.googleapis.com/google.rpc.Help";
const REASON = "VALIDATION_REQUIRED";
const MAX_URL_BYTES = 8192;
const ALLOWED_DOMAINS = new Set([
  "cloudcode-pa.googleapis.com",
  "staging-cloudcode-pa.googleapis.com",
  "autopush-cloudcode-pa.googleapis.com",
]);
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export function validateAntigravityVerificationUrl(candidate) {
  if (typeof candidate !== "string" || candidate !== candidate.trim() || CONTROL_RE.test(candidate)) return null;
  if (new TextEncoder().encode(candidate).length < 1 || new TextEncoder().encode(candidate).length > MAX_URL_BYTES) return null;
  let parsed;
  try { parsed = new URL(candidate); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.hostname !== "accounts.google.com") return null;
  if (parsed.port || parsed.username || parsed.password) return null;
  return new TextEncoder().encode(parsed.href).length <= MAX_URL_BYTES ? parsed.href : null;
}
```

Classification follows the approved precedence exactly. Do not trim `domain` or `reason`. If the selected first Help link exists but is invalid, return `null` without consulting metadata. Redaction parses JSON when possible, recursively replaces only the three named validation fields and Help URLs associated with structured validation details, then removes malformed `https://accounts.google.com/...` tokens from the serialized or raw diagnostic. Clamp diagnostics only after redaction at the existing 200-character call sites.

Reject an unknown `source`. Accept the successful ineligible-tier contract only for `source: "loadCodeAssist"` with an HTTP 2xx status and no `currentTier`. Accept the strict RPC contract for any of the four sources only at HTTP 403, with `error.code` either absent or exactly 403.

**Step group 5: Implement typed project and usage outcomes**

- [ ] **Step 5a:** Convert the pending project entry to the executable typed-outcome shape below.
- [ ] **Step 5b:** Add one continuation per waiter with isolated callback catches.
- [ ] **Step 5c:** Single-read and classify load/onboard bodies, identity-check pending cleanup, then run `./node_modules/.bin/vitest run unit/antigravity-project-outcome.test.js` from `tests/` for 11 passed.
- [ ] **Step 5d:** Single-read and classify subscription/quota bodies without changing public JSON shapes.
- [ ] **Step 5e:** Add the private `WeakSet` usability marker and terminal usage callback.
- [ ] **Step 5f:** Run `./node_modules/.bin/vitest run unit/antigravity-usage-validation.test.js` from `tests/` for 12 passed.

Refactor the project pending map to retain a typed promise and operation metadata. The following is executable JavaScript; express the `ProjectOutcome` union with JSDoc rather than TypeScript syntax in this `.js` file.

```js
const pendingEntry = {
  promise: outcomePromise,
  controller,
  startedAt: Date.now(),
  observationId: firstHooks.verificationContext?.observationId ?? crypto.randomUUID(),
  challengeIdAtStart: firstHooks.verificationContext?.challengeIdAtStart ?? null,
};
pendingFetches.set(connectionId, pendingEntry);
```

Every caller, including a late waiter, attaches its own continuation to the same typed promise. Validation invokes each waiter with the pending entry's one observation ID. Project success invokes each waiter with the pending entry's first `challengeIdAtStart`. Wrap each callback independently. Cache hits invoke neither callback. A callback error logs only callback type plus a connection ID prefix.

Every completion, rejection, timeout, and abort cleanup is identity-safe. The operation's `finally` deletes only when `pendingFetches.get(connectionId) === pendingEntry`. The RED starts operation A, calls the existing `removeConnection(connectionId)` so A is aborted and removed, starts replacement B under the same connection ID, releases A, and proves A cannot delete B. A subsequent waiter must still join B and receive B's single typed outcome.

Classify each raw load and onboard body before constructing any diagnostic. Apply `redactAntigravityValidationText` before values cross project callback-error logging, request logging, thrown errors, public errors, or serialized responses. The raw body and raw validation URL never reach those sinks even when classification is rejected because the transport status is disguised as HTTP 200.

Read each load, onboard, subscription, and quota body exactly once with `text()`, parse from that text, classify before creating diagnostics, and redact before logging or serializing. `getProjectIdForConnection` projects `{ kind: "project" }` to the string and every other outcome to `null` only after waiter callbacks observe the typed result.

For Antigravity usage, preserve current headers, proxy options, 401 and 403 messages, and current JSON result shapes. Keep successful formatted result objects in a module-private `WeakSet`; this makes usability observable to the dedicated server route without adding a serializable field or changing the result object returned by the engine.

```js
const usableAntigravityUsageResults = new WeakSet();

export function isUsableAntigravityUsageResult(value) {
  return Boolean(value && typeof value === "object" && usableAntigravityUsageResults.has(value));
}
```

Read and parse the raw quota payload once. Only when the 2xx parsed payload has a non-array `models` object and no structured error, add its formatted public result object to the `WeakSet`, invoke verification success, and return that same object. Do not mark or clear for a message, subscription object, malformed body, HTTP error, timeout, or transport error. The recheck route calls the exported predicate on the unchanged result object before deciding its boolean response.

**Step group 6: Preserve typed chat metadata and replace the complete retry state**

- [ ] **Step 6a:** Add only the Antigravity executor import and `parseError` override.
- [ ] **Step 6b:** Preserve internal validation through `parseUpstreamError` without changing `createErrorResult`.
- [ ] **Step 6c:** Invoke validation recording before the sanitized ordinary error result.
- [ ] **Step 6d:** Replace all six retry-state fields and target logging from the retry result.
- [ ] **Step 6e:** Route every thrown retry failure through `mapTransportError` and remove original-response resurrection.
- [ ] **Step 6f:** Update the one obsolete existing test and run `./node_modules/.bin/vitest run unit/antigravity-retry-response.test.js unit/chat-connect-timeout-propagation.test.js` from `tests/`.

Add `AntigravityExecutor.parseError(response, bodyText)` after current request transformation methods. Call `super.parseError`, parse the already-read text, classify with source `chat`, redact the message, and return `validation` as an internal sibling field.

`parseUpstreamError` must copy `parsed.validation` to its internal return value. `createErrorResult` remains unchanged and never receives the validation object or URL. `handleChatCore` invokes `onValidationRequired` before building the normal error result and catches callback failure without logging the URL.

Redaction occurs before every chat sink. `AntigravityExecutor.parseError` redacts the already-read text even when strict classification returns `null`, then only the redacted diagnostic can reach streaming handlers, non-streaming handlers, `createErrorResult`, `mapTransportError`, request logs, console logs, or JSON serialization. Do not rely on a downstream UI or serializer to remove the URL.

Replace the refresh retry block regardless of `response.ok`.

```js
const retryResult = await executor.execute(retryOptions);
providerResponse = retryResult.response;
providerUrl = retryResult.url;
providerHeaders = retryResult.headers;
finalBody = retryResult.transformedBody;
providerResponseFormat = retryResult.responseFormat || targetFormat;
reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);
```

Any retry exception returns `mapTransportError(error)`. Delete the catch path that resurrects the original 401 or 403. Update the one obsolete existing test named `retains the original 401 for an unrelated credential-refresh retry error` to expect the retry's 502 mapping. Do not change field-strip retry semantics.

**Step group 7: Add terminal-only verification success**

- [ ] **Step 7a:** Add the three verification fields and one snapshot-bound notifier to `handleChatCore`.
- [ ] **Step 7b:** Pass the notifier through both `sharedCtx` construction sites.
- [ ] **Step 7c:** Add the usable non-stream terminal call without moving account-health timing.
- [ ] **Step 7d:** Add the forced-SSE-to-JSON usable-output terminal call.
- [ ] **Step 7e:** Add the non-aborted useful EOF/flush call in `buildOnStreamComplete` only.
- [ ] **Step 7f:** Run `./node_modules/.bin/vitest run unit/antigravity-terminal-verification.test.js unit/stream-first-valid-event-gate.test.js unit/streaming-interrupted-detail.test.js` from `tests/`.

Add `verificationContext`, `onValidationRequired`, and `onVerificationSuccess` to `handleChatCore`. Bind one internal no-argument callback that snapshots `verificationContext.challengeIdAtStart` and calls the public typed callback best-effort.

```js
const notifyTerminalVerificationSuccess =
  onVerificationSuccess && verificationContext?.challengeIdAtStart
    ? async () => {
        try {
          await onVerificationSuccess({ challengeId: verificationContext.challengeIdAtStart });
        } catch (error) {
          log?.warn?.("VERIFICATION", `success callback failed for ${String(connectionId).slice(0, 8)}`);
        }
      }
    : null;
```

Pass that callback through `sharedCtx` without replacing `onRequestSuccess`.

- `nonStreamingHandler.js` calls it once after `hasUsefulContent(...)` succeeds and before returning the response.
- `sseToJsonHandler.js` calls it once only when parsed output has non-empty text, thinking, a tool call, or output tokens. Error and empty results never call it.
- `streamingHandler.js` leaves first-event `onRequestSuccess` unchanged. `buildOnStreamComplete` calls it only when `aborted === false` and the same text, thinking, or output-token predicate used by empty-stream detection is true.
- `onStreamAbandoned`, client cancellation, reset, timeout, empty EOF, and duplicate completion never call it.

**Step group 8: Run Phase 1 GREEN, static gates, and review gate**

- [ ] **Step 8a:** Run the exact 189-test combined command below from `tests/`.
- [ ] **Step 8b:** Run each `node --check` command below from the worktree root.
- [ ] **Step 8c:** Run the Phase 1 ESLint command and `git diff --check`.
- [ ] **Step 8d:** Prove the fingerprint constant files are unchanged and inspect the executor zero-context diff.
- [ ] **Step 8e:** Request a fresh Phase 1 review and resolve every Critical or Important finding before commit.

Run the five new files plus the measured 98-test adjacency list from `tests/`. Expected result is exactly 189 passed and zero failed.

```bash
set -euo pipefail
./node_modules/.bin/vitest run \
  unit/antigravity-validation.test.js \
  unit/antigravity-project-outcome.test.js \
  unit/antigravity-usage-validation.test.js \
  unit/antigravity-retry-response.test.js \
  unit/antigravity-terminal-verification.test.js \
  unit/gemini-36-integration.test.js \
  unit/antigravity-retry-hook.test.js \
  unit/antigravity-usage-headers.test.js \
  unit/antigravity-image-editing.test.js \
  unit/antigravity-ide-version-sync.test.js \
  unit/chat-connect-timeout-propagation.test.js \
  unit/stream-first-valid-event-gate.test.js \
  unit/streaming-interrupted-detail.test.js \
  unit/adaptive-stripper.test.js \
  unit/account-fallback-rules.test.js
```

Run syntax and lint from the worktree root.

```bash
set -euo pipefail
node --check open-sse/services/antigravityValidation.js
node --check open-sse/executors/antigravity.js
node --check open-sse/services/projectId.js
node --check open-sse/services/usage/google.js
node --check open-sse/services/usage.js
node --check open-sse/utils/error.js
node --check open-sse/handlers/chatCore.js
node --check open-sse/handlers/chatCore/nonStreamingHandler.js
node --check open-sse/handlers/chatCore/sseToJsonHandler.js
node --check open-sse/handlers/chatCore/streamingHandler.js
./node_modules/.bin/eslint open-sse/services/antigravityValidation.js open-sse/executors/antigravity.js open-sse/services/projectId.js open-sse/services/usage/google.js open-sse/services/usage.js open-sse/utils/error.js open-sse/handlers/chatCore.js open-sse/handlers/chatCore/nonStreamingHandler.js open-sse/handlers/chatCore/sseToJsonHandler.js open-sse/handlers/chatCore/streamingHandler.js tests/unit/antigravity-validation.test.js tests/unit/antigravity-project-outcome.test.js tests/unit/antigravity-usage-validation.test.js tests/unit/antigravity-retry-response.test.js tests/unit/antigravity-terminal-verification.test.js tests/unit/chat-connect-timeout-propagation.test.js
git diff --check
git diff --exit-code 9d8193182 -- open-sse/providers/shared.js open-sse/config/appConstants.js
```

Inspect `git diff --unified=0 9d8193182 -- open-sse/executors/antigravity.js`. Before commit, the only executor edits must be one import and one `parseError` method. Request a fresh Phase 1 review. Stop on any Critical or Important finding.

- [ ] **Step 9: Commit Phase 1**

```bash
set -euo pipefail
git add open-sse/services/antigravityValidation.js open-sse/executors/antigravity.js open-sse/services/projectId.js open-sse/services/usage/google.js open-sse/services/usage.js open-sse/utils/error.js open-sse/handlers/chatCore.js open-sse/handlers/chatCore/nonStreamingHandler.js open-sse/handlers/chatCore/sseToJsonHandler.js open-sse/handlers/chatCore/streamingHandler.js tests/unit/antigravity-validation.test.js tests/unit/antigravity-project-outcome.test.js tests/unit/antigravity-usage-validation.test.js tests/unit/antigravity-retry-response.test.js tests/unit/antigravity-terminal-verification.test.js tests/unit/chat-connect-timeout-propagation.test.js
git commit -m "feat(antigravity): classify account verification"
test "$(git log -1 --format=%s)" = "feat(antigravity): classify account verification"
test -z "$(git status --porcelain)"
```

Expected subject is exactly `feat(antigravity): classify account verification`. Worktree must be clean before Task 2.

---

## Task 2: Add bounded state, exhaustive wiring, and sensitive routes

**Files:**
- Create: `src/lib/antigravityVerification.js`
- Create: `src/lib/auth/antigravityVerificationAccess.js`
- Create: `src/app/api/providers/antigravity/verification/stream/route.js`
- Create: `src/app/api/providers/antigravity/verification/[connectionId]/route.js`
- Create: `src/app/api/providers/antigravity/verification/[connectionId]/recheck/route.js`
- Create: `tests/fixtures/antigravity-verification-access.js`
- Create: `tests/unit/antigravity-verification-state.test.js`
- Create: `tests/unit/antigravity-verification-access.test.js`
- Create: `tests/unit/antigravity-verification-routes.test.js`
- Create: `tests/unit/antigravity-verification-callers.test.js`
- Create: `tests/unit/antigravity-verification-privacy.test.js`
- Modify: `src/sse/handlers/chat.js:279-387`
- Modify: `src/sse/services/tokenRefresh.js:72-142`
- Modify: `src/sse/services/quotaGuard.js:58-115`
- Modify: `src/app/api/providers/[id]/hotreload/route.js:19-159`
- Modify: `src/app/api/usage/[connectionId]/route.js:125-261`
- Modify: `src/app/api/providers/[id]/route.js:188-202`

**Interfaces:**
- Consumes: Phase 1 typed callbacks, validator, redactor, usable-usage predicate, current database access, proxy resolution, and current credential refresh.
- Produces: connection-scoped bounded state, URL-free multicast, invalidatable trusted hook lifetimes, 4 sensitive route methods, exact auth and CSRF policy, and 94 tests.
- Preserves: caller credential refresh, proxy options, quota persistence, three-second routing timeout, hot-reload retry and result handling, and all non-Antigravity usage calls.

**Step group 1: Record the Phase 2 baseline**

- [ ] **Step 1a:** Re-run the clean-status and dependency assertions.
- [ ] **Step 1b:** Run the measured Phase 2 adjacency command from `tests/` and record 104 passed.
- [ ] **Step 1c:** Write the 10 privacy preservation tests from Step group 7.
- [ ] **Step 1d:** Run the privacy command on the committed Phase 1 baseline and record 10 passed.

Run from `tests/`.

```bash
set -euo pipefail
./node_modules/.bin/vitest run \
  unit/background-token-refresh.test.js \
  unit/token-refresh-generic.test.js \
  unit/quota-pause.test.js \
  unit/provider-cleanup.test.js \
  unit/dashboard-guard.test.js \
  unit/usage-stats-masked-key.test.js \
  unit/usage-stream-listener-leak.test.js \
  unit/antigravity-usage-headers.test.js \
  unit/chat-request-replay.test.js
```

Expected result is exactly 104 passed and zero failed.

**Step group 2: Write state RED and implement the bounded service**

- [ ] **Step 2a:** Add isolation, generation, and the three observation-idempotency cases.
- [ ] **Step 2b:** Add lazy-expiry, sweep-expiry, and timer-unref fake-clock cases.
- [ ] **Step 2c:** Add live-cap, restart-empty, ledger-cap, ledger-expiry, and ledger-deletion cases.
- [ ] **Step 2d:** Add stale dismissal, matching clear, and older-success race cases.
- [ ] **Step 2e:** Add late chat, project, and usage callback cases across successful deletion and same-ID replacement.
- [ ] **Step 2f:** Run the state command and record the missing-module RED.
- [ ] **Step 2g:** Implement private maps, generation, lazy/sweep cleanup, and unreferenced timer.
- [ ] **Step 2h:** Implement synchronous record, sanitized emission, caps, compare-removal, and lifetime invalidation.
- [ ] **Step 2i:** Re-run the state command and record 19 passed.

Write the 19 state tests before creating `src/lib/antigravityVerification.js`. Initial RED is one suite collection failure naming the missing module.

| Count | Exact state cases |
| ---: | --- |
| 2 | per-connection isolation; globally increasing safe-integer generations |
| 3 | same observation records once; delayed old observation cannot replace newer; dismissed old observation cannot resurrect |
| 3 | ten-minute lazy expiry; one-minute sweep expiry; timer calls `unref()` |
| 2 | 256 live-entry cap with oldest-observed eviction; restart or module reload begins empty |
| 3 | 1,024 ledger cap and oldest-seen eviction; ledger expires at ten minutes; connection deletion clears entry and ledger pairs |
| 3 | stale dismissal rejects; matching clear succeeds; older success cannot clear newer challenge |
| 3 | one table-driven case each for old chat, project, and usage hook sets; after deletion and same-ID replacement, each old set invokes both validation and success callbacks and can neither resurrect deleted state nor clear or evict the replacement, while the fresh hook set can record and clear it |

Use `vi.useFakeTimers()`, `vi.setSystemTime()`, and `vi.resetModules()` rather than adding a public test clock. The URL-free event assertion is part of every record and remove case.

The module-private data structures are exact.

```js
const liveByConnection = new Map();
const seenObservations = new Map();
const activeLifetimeByConnection = new Map();
const events = new EventEmitter();
let generation = 0;

// live entry
{ connectionId, challengeId, generation, observationId, url, observedAt, expiresAt }

// ledger entry, key is `${connectionId}\u0000${observationId}`
{ connectionId, observationId, seenAt }
```

Validate the callback URL again before storing it. Mark the observation pair and update the map synchronously before emitting. Repeated observation delivery must not refresh TTL, increment generation, emit, resurrect, or replace. Expiry, capacity eviction, dismissal, success clear, and connection deletion emit only sanitized removal values.

`createAntigravityVerificationHooks` captures a module-private `Symbol()` lifetime shared by hooks created while the connection is live. Callback closures pass that opaque token into record and success-clear operations. `invalidateAntigravityVerificationConnection` deletes the active token before it removes the live entry and ledger pairs. A callback carrying a missing or mismatched token is a no-op, so hooks captured before successful deletion cannot record, clear, evict, or resurrect anything. Creating hooks later for a newly created connection with the same ID allocates a new token and remains functional. No token crosses `VerificationContext`, an event, a response, a log, or serialized state.

Run this command from `tests/` before and after production implementation.

```bash
set -euo pipefail
./node_modules/.bin/vitest run unit/antigravity-verification-state.test.js
```

Initial RED is the named missing-module collection failure. GREEN is exactly 19 passed.

**Step group 3: Write auth and CSRF RED, then implement the dedicated boundary**

- [ ] **Step 3a:** Create the shared identity and mutation fixture module.
- [ ] **Step 3b:** Add the seven identity rows under `requireLogin=true`.
- [ ] **Step 3c:** Add the same seven rows under `requireLogin=false` and all loopback forms.
- [ ] **Step 3d:** Add the 2 allowed and first 6 rejected mutation fixtures.
- [ ] **Step 3e:** Add the remaining 6 rejected mutation fixtures and body-access ordering spies.
- [ ] **Step 3f:** Run the access command and record the missing-helper RED.
- [ ] **Step 3g:** Implement exact trusted-peer, JWT, CLI, settings, and loopback authorization.
- [ ] **Step 3h:** Implement exact Origin and `Sec-Fetch-Site` validation plus common headers.
- [ ] **Step 3i:** Re-run the access command and record 28 passed.

Write the 28 access tests before creating the helper. Initial RED is one suite collection failure naming the missing module.

The 14 identity cases are the approved seven-row table under both `requireLogin=true` and `requireLogin=false`. Each case exercises the helper with trusted-peer proof, real-IP forms, proxy-stamp presence, JWT result, CLI result, and settings result independently. Include exact loopback acceptance for `127.0.0.1`, `::1`, and `::ffff:127.0.0.1` inside those cases. A bare development Host, forged Host, Origin, XFF, or unstamped real IP never authorizes. Put the table in `tests/fixtures/antigravity-verification-access.js` and import it in both suites; helper-only coverage is not the final authorization gate.

The 14 mutation cases are exact.

| Result | Count | Inputs |
| --- | ---: | --- |
| Allow | 2 | exact same-origin `Origin` plus `Sec-Fetch-Site: same-origin`; valid CLI token with both absent |
| Reject 403 | 12 | missing Origin; malformed Origin; cross-origin; trailing slash; path; credentials; opaque `null`; alternate textual origin; missing Sec-Fetch-Site; `same-site`; `cross-site`; `none` |

Authorization runs before CSRF. CSRF runs before body access. The local no-login exception requires all three exact conditions.

```js
const trustedDirectLoopback =
  hasTrustedPeerHeaders(request) &&
  !request.headers.has("x-9r-via-proxy") &&
  isExactStampedLoopback(request.headers.get("x-9r-real-ip"));

const jwt = await verifyDashboardAuthToken(request.cookies.get("auth_token")?.value);
const cli = await hasValidCliToken(request);
const allowLocalNoLogin = settings?.requireLogin === false && trustedDirectLoopback;
```

Every helper-generated success or error response gets all security headers.

```js
{
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
}
```

The helper exports the four-entry `sensitive-verification` route inventory and never calls `isLocalRequest`. Run this command from `tests/` before and after helper implementation.

```bash
set -euo pipefail
./node_modules/.bin/vitest run unit/antigravity-verification-access.test.js
```

Initial RED is the named missing-module collection failure. GREEN is exactly 28 passed.

**Step group 4: Write the 14 exhaustive caller RED tests**

- [ ] **Step 4a:** Add the two exact source-inventory assertions.
- [ ] **Step 4b:** Add the three chat and proactive-project caller cases.
- [ ] **Step 4c:** Add the two quota-guard timeout and late-outcome cases.
- [ ] **Step 4d:** Add the two hot-reload wrapper and direct-poke cases.
- [ ] **Step 4e:** Add the two usage-route snapshot cases.
- [ ] **Step 4f:** Add the recheck and wrapper-allowlist cases.
- [ ] **Step 4g:** Add successful and failed provider-deletion invalidation cases.
- [ ] **Step 4h:** Run the caller command and record 14 failed.

Use module mocks plus a source inventory assertion. All 14 tests must fail before call-site edits because each requires a named explicit hook path.

| Count | Exact caller cases |
| ---: | --- |
| 2 | inventory finds exactly 2 project callers and 4 generic Antigravity-capable usage callers; no unwrapped new caller exists |
| 2 | chat cold project records and clears only extracted project success; chat snapshots again immediately before `handleChatCore` |
| 1 | proactive token refresh keeps project lookup non-blocking and supplies hooks |
| 2 | quota guard delivers a challenge even after its three-second race times out; only later usable quota clears |
| 2 | every hot-reload quota attempt uses a fresh wrapper; direct 403 poke reads once and records while 2xx, 429, 5xx, abort, and timeout do not clear |
| 2 | initial and post-refresh usage calls each snapshot independently; existing `force=1` stays explicit |
| 2 | dedicated recheck uses the wrapper with submitted challenge ID; wrapper forwards only `force` and trusted hook fields |
| 1 | provider deletion invalidates the connection only after a deleted row is returned; a rejected or empty deletion leaves the lifetime and state intact |

The static inventory command used by the test is conceptually exact.

```js
expect(projectCallers).toEqual([
  "src/sse/handlers/chat.js",
  "src/sse/services/tokenRefresh.js",
]);
expect(usageCallers).toEqual([
  "src/app/api/providers/[id]/hotreload/route.js",
  "src/app/api/usage/[connectionId]/route.js",
  "src/sse/services/quotaGuard.js",
  "src/lib/antigravityVerification.js",
]);
```

**Step group 5: Implement hook creation, wrapper use, and every caller**

- [ ] **Step 5a:** Implement the hook factory from the exact code below.
- [ ] **Step 5b:** Implement the one-attempt usage wrapper with only two accepted options.
- [ ] **Step 5c:** Wire cold-chat project lookup and the fresh pre-chat snapshot.
- [ ] **Step 5d:** Wire the non-blocking proactive token-refresh project lookup.
- [ ] **Step 5e:** Wire quota guard without cancelling or suppressing its losing promise.
- [ ] **Step 5f:** Wire every hot-reload usage attempt and its single-read direct 403 poke.
- [ ] **Step 5g:** Wire both usage-route attempts and post-delete state removal.
- [ ] **Step 5h:** Run the caller command and preserve the one dedicated-recheck RED.

`createAntigravityVerificationHooks` snapshots synchronously and allocates one observation ID per underlying attempt.

```js
export function createAntigravityVerificationHooks(connectionId, expectedChallengeId) {
  const connectionLifetime = getOrCreateConnectionLifetime(connectionId);
  const current = getAntigravityVerification(connectionId);
  const challengeIdAtStart = expectedChallengeId === undefined
    ? current?.challengeId ?? null
    : expectedChallengeId;
  const observationId = crypto.randomUUID();
  return {
    verificationContext: { connectionId, observationId, challengeIdAtStart },
    onValidationRequired: ({ validation, observationId: observedId }) =>
      recordAntigravityValidation(connectionId, { validation, observationId: observedId }, connectionLifetime),
    onVerificationSuccess: ({ challengeId }) =>
      clearAntigravityVerificationIfCurrent(connectionId, challengeId, connectionLifetime),
  };
}
```

`runAntigravityUsageProbe` creates a fresh hook set for exactly one `getUsageForProvider` call, passes only `force === true`, and returns the usage result unchanged.

Wire the exact inventory.

- Chat creates one hook set before cold project lookup and a fresh hook set immediately before `handleChatCore`.
- Token refresh creates hooks before its non-blocking project promise. Gemini CLI remains callback-free.
- Quota guard races the wrapper promise without aborting or suppressing the losing promise's callbacks.
- Hot reload calls the wrapper for each verification attempt. A direct 403 reads `text()` once, parses once, classifies with source `chat`, invokes its fresh validation callback, then returns the existing failed-auth result. Other direct poke outcomes never invoke verification success.
- Usage route calls the wrapper for initial and retry Antigravity reads. Each call allocates its own snapshot. Other providers call the engine directly as before.
- Provider deletion calls `invalidateAntigravityVerificationConnection(id)` only after `deleteProviderConnection(id)` returns a deleted row. Invalidation happens before returning the successful response. A thrown deletion or an empty result does not invalidate.

The deletion RED retains old hook closures for chat, proactive project lookup, and usage, deletes the provider successfully, creates a replacement connection with the same ID and fresh hook lifetime, and releases the old promises. Late old validation callbacks cannot recreate the deleted entry, late old success callbacks cannot clear or evict the replacement entry, and the fresh replacement hooks still work. The failed-deletion branch proves the current hooks remain valid.

Run this command from `tests/` before and after call-site implementation.

```bash
set -euo pipefail
./node_modules/.bin/vitest run unit/antigravity-verification-callers.test.js
```

RED is exactly 14 failed. After this step, expect 13 passed and the one route-owned dedicated-recheck assertion still RED. Do not weaken it. Step 6 implements the recheck route and must make all 14 caller tests GREEN.

**Step group 6: Write route RED and implement all four sensitive methods**

- [ ] **Step 6a:** Add the five stream cases and run the missing-route RED.
- [ ] **Step 6b:** Add the five detail and five dismissal cases.
- [ ] **Step 6c:** Add the eight recheck cases.
- [ ] **Step 6d:** Parameterize all four methods over the shared identity matrix.
- [ ] **Step 6e:** Parameterize DELETE and POST over the full mutation matrix.
- [ ] **Step 6f:** Implement stream framing, heartbeat, headers, and idempotent cleanup.
- [ ] **Step 6g:** Implement exact detail and compare-dismissal outcomes.
- [ ] **Step 6h:** Implement forced recheck, usability marker evaluation, repeated challenge, and sanitized failures.
- [ ] **Step 6i:** Run route GREEN for 23 passed, then route plus caller GREEN for 37 passed.

Write the 23 route tests before the three route modules. Initial RED is one suite collection failure naming the first missing route.

Reuse every exported identity fixture from the access suite against stream, detail, dismissal, and recheck. For each request, run the current dashboard guard first and then the route-local helper; prove that an outer middleware allow never bypasses the sensitive denial. Reuse every mutation fixture against both DELETE and POST, including JWT-cookie, trusted local no-login, and CLI-token callers. Each table-driven test may loop the matrix, but no route method or matrix row may be sampled away.

| Area | Count | Exact cases |
| --- | ---: | --- |
| Stream | 5 | initial sanitized snapshot; sanitized upsert/remove; 25-second comment heartbeat; request abort cleanup; stream cancel cleanup and no listener growth |
| Detail | 5 | exact success shape; missing connection; wrong provider; missing state; expired state, with all four failures sharing one 404 body |
| Dismissal | 5 | current ID gives 204; stale ID gives 409 without current ID; missing gives 404; CSRF runs before body; connection row is untouched |
| Recheck | 8 | usable quota gives `{ verified: true }`; repeated challenge gives `{ verified: false }`; auth failure; transport fallback 502; malformed result; generic provider failure; stale ID 409; wrong provider 404 |

For every detail, dismissal, and recheck, authorize first, then load the exact connection, require `provider === "antigravity"`, then inspect current state. Use the same 404 JSON for all missing, expired, deleted, wrong-provider, and unknown cases. Detail success contains exactly `{ challengeId, expiresAt, href }`. A stale submitted ID returns 409 without any replacement ID.

The stream event wire format is exact.

```text
event: snapshot
data: {"entries":[{"connectionId":"...","challengeId":"...","expiresAt":0}]}

event: upsert
data: {"connectionId":"...","challengeId":"...","expiresAt":0}

event: remove
data: {"connectionId":"...","challengeId":"..."}

: heartbeat

```

The stream uses `text/event-stream; charset=utf-8`, `Cache-Control: private, no-store, max-age=0, no-transform`, `X-Accel-Buffering: no`, the common security headers, one abort listener, one emitter listener, one heartbeat timer, and idempotent cleanup.

Recheck calls `runAntigravityUsageProbe(connection, proxyOptions, { force: true, expectedChallengeId: submittedId })` and evaluates the returned object with `isUsableAntigravityUsageResult`. A usable result is verified only if the submitted challenge is absent after callback processing. A different current ID means a repeated or concurrent challenge and returns `{ verified: false }`, even if the quota leg was usable. A same-ID result, an unmarked result, or a vanished challenge without a usable marker is a failure and never becomes a false positive. Return a redacted bounded error with the existing mapped status when available and 502 otherwise. No body or error contains an upstream payload or href.

Run this command from `tests/` before and after route implementation.

```bash
set -euo pipefail
./node_modules/.bin/vitest run unit/antigravity-verification-routes.test.js
```

Initial RED is the named missing-route collection failure. GREEN is exactly 23 passed.

Then run the route and caller suites together. Expected GREEN is exactly 37 passed.

```bash
set -euo pipefail
./node_modules/.bin/vitest run unit/antigravity-verification-routes.test.js unit/antigravity-verification-callers.test.js
```

**Step group 7: Re-run the 10 privacy preservation tests**

- [ ] **Step 7a:** Re-run active-request, usage-stats, general-SSE, and request-detail exclusions.
- [ ] **Step 7b:** Re-run public-error, process-global, sensitive-SSE, and header/log exclusions.
- [ ] **Step 7c:** Re-run OAuth project/onboard and disguised HTTP-200 sink-ordering exclusions.
- [ ] **Step 7d:** Record 10 passed after every Phase 2 path is integrated.

The original eight exclusion tests pass on the pre-feature baseline. The two sink-ordering behaviors are first recorded RED in Task 1 inside the project-outcome and terminal-verification suites, before the Phase 1 production edits. This Phase 2 privacy suite repeats those realistic fixtures as independent preservation coverage and must pass on the committed Phase 1 baseline before Phase 2 edits, then remain green.

| Count | Exact exclusion |
| ---: | --- |
| 1 | `getActiveRequests` output |
| 1 | `getUsageStats` output |
| 1 | general `/api/usage/stream` payload |
| 1 | request detail and request log payloads |
| 1 | public error object and serialized response |
| 1 | `globalThis` and known global aliases |
| 1 | sensitive SSE snapshot and deltas |
| 1 | route headers, logs, and `Location` |
| 1 | loadCodeAssist and onboardUser raw diagnostics never reach console, a mocked disk-log sink, callback errors, or serialized public responses |
| 1 | disguised HTTP-200 chat errors never reach streaming or non-streaming response JSON, console, request logs, or a mocked disk-log sink |

Use both `REALISTIC_VALIDATION_URLS` values from Task 1, repeated locally in this isolated test module, rather than a toy `/verify` URL. The project fixture embeds the AccountChooser URL in loadCodeAssist and the `/v3/signin/challenge/pwd` URL in an onboardUser RPC body. The chat fixture embeds each URL in a strict RPC-shaped body delivered with HTTP status 200. Scan every disk-log write, captured console call, request-detail payload, public error object, and `JSON.stringify` result for the full URLs, `project-secret`, `onboard-secret`, `continue=`, and `flowName=`. Each scan must be empty. Temporary disk-log captures live under `/tmp`, are opened only by an injected test logger, and are removed in `afterEach`.

The implementation contract is ordering, not cleanup after exposure. Classify and redact raw project load/onboard, usage, retry, streaming, and non-streaming bodies before invoking any public-error constructor, response serializer, request logger, console logger, callback-error logger, or stream writer. The URL-bearing validation object remains internal only long enough to invoke the trusted hook and never becomes a sibling on a public object.

Run from `tests/` first in Step 1d and again here after integrating every Phase 2 path. Both runs must report exactly 10 passed.

```bash
set -euo pipefail
./node_modules/.bin/vitest run unit/antigravity-verification-privacy.test.js
```

**Step group 8: Run Phase 2 GREEN, static gates, and review gate**

- [ ] **Step 8a:** Run the exact 289-test combined command below from `tests/`.
- [ ] **Step 8b:** Run every route, service, and caller `node --check` command.
- [ ] **Step 8c:** Run Phase 2 ESLint and `git diff --check`.
- [ ] **Step 8d:** Prove every excluded ownership path stayed unchanged.
- [ ] **Step 8e:** Request a fresh Phase 2 review and resolve every Critical or Important finding.

Run all 10 Phase 1 and Phase 2 feature files plus the measured 104-test adjacency list from `tests/`. Expected result is exactly 289 passed and zero failed.

```bash
set -euo pipefail
./node_modules/.bin/vitest run \
  unit/antigravity-validation.test.js \
  unit/antigravity-project-outcome.test.js \
  unit/antigravity-usage-validation.test.js \
  unit/antigravity-retry-response.test.js \
  unit/antigravity-terminal-verification.test.js \
  unit/antigravity-verification-state.test.js \
  unit/antigravity-verification-access.test.js \
  unit/antigravity-verification-routes.test.js \
  unit/antigravity-verification-callers.test.js \
  unit/antigravity-verification-privacy.test.js \
  unit/background-token-refresh.test.js \
  unit/token-refresh-generic.test.js \
  unit/quota-pause.test.js \
  unit/provider-cleanup.test.js \
  unit/dashboard-guard.test.js \
  unit/usage-stats-masked-key.test.js \
  unit/usage-stream-listener-leak.test.js \
  unit/antigravity-usage-headers.test.js \
  unit/chat-request-replay.test.js
```

Run from the worktree root.

```bash
set -euo pipefail
node --check src/lib/antigravityVerification.js
node --check src/lib/auth/antigravityVerificationAccess.js
node --check src/app/api/providers/antigravity/verification/stream/route.js
node --check 'src/app/api/providers/antigravity/verification/[connectionId]/route.js'
node --check 'src/app/api/providers/antigravity/verification/[connectionId]/recheck/route.js'
node --check src/sse/handlers/chat.js
node --check src/sse/services/tokenRefresh.js
node --check src/sse/services/quotaGuard.js
node --check 'src/app/api/providers/[id]/hotreload/route.js'
node --check 'src/app/api/usage/[connectionId]/route.js'
node --check 'src/app/api/providers/[id]/route.js'
./node_modules/.bin/eslint src/lib/antigravityVerification.js src/lib/auth/antigravityVerificationAccess.js src/app/api/providers/antigravity/verification/stream/route.js 'src/app/api/providers/antigravity/verification/[connectionId]/route.js' 'src/app/api/providers/antigravity/verification/[connectionId]/recheck/route.js' src/sse/handlers/chat.js src/sse/services/tokenRefresh.js src/sse/services/quotaGuard.js 'src/app/api/providers/[id]/hotreload/route.js' 'src/app/api/usage/[connectionId]/route.js' 'src/app/api/providers/[id]/route.js' tests/fixtures/antigravity-verification-access.js tests/unit/antigravity-verification-state.test.js tests/unit/antigravity-verification-access.test.js tests/unit/antigravity-verification-routes.test.js tests/unit/antigravity-verification-callers.test.js tests/unit/antigravity-verification-privacy.test.js
git diff --check
```

Prove excluded ownership stayed untouched.

```bash
set -euo pipefail
git diff --exit-code 9d8193182 -- src/dashboardGuard.js src/lib/db/repos/usageRepo.js src/lib/usageDb.js src/app/api/usage/stream/route.js src/shared/components/UsageStats.js src/shared/components/layouts/DashboardLayout.js package.json package-lock.json
```

Request a fresh Phase 2 review. Stop on any Critical or Important finding.

- [ ] **Step 9: Commit Phase 2**

```bash
set -euo pipefail
git add src/lib/antigravityVerification.js src/lib/auth/antigravityVerificationAccess.js src/app/api/providers/antigravity/verification/stream/route.js 'src/app/api/providers/antigravity/verification/[connectionId]/route.js' 'src/app/api/providers/antigravity/verification/[connectionId]/recheck/route.js' src/sse/handlers/chat.js src/sse/services/tokenRefresh.js src/sse/services/quotaGuard.js 'src/app/api/providers/[id]/hotreload/route.js' 'src/app/api/usage/[connectionId]/route.js' 'src/app/api/providers/[id]/route.js' tests/fixtures/antigravity-verification-access.js tests/unit/antigravity-verification-state.test.js tests/unit/antigravity-verification-access.test.js tests/unit/antigravity-verification-routes.test.js tests/unit/antigravity-verification-callers.test.js tests/unit/antigravity-verification-privacy.test.js
git commit -m "feat(antigravity): secure account verification"
test "$(git log -1 --format=%s)" = "feat(antigravity): secure account verification"
test -z "$(git status --porcelain)"
```

Expected subject is exactly `feat(antigravity): secure account verification`. Worktree must be clean before Task 3.

---

## Task 3: Add the provider-page action, recheck flow, and localization

**Files:**
- Create: `src/app/(dashboard)/dashboard/providers/[id]/useAntigravityVerification.js`
- Create: `tests/unit/antigravity-verification-client.test.js`
- Create: `tests/unit/antigravity-verification-ui.test.js`
- Create: `tests/unit/antigravity-verification-locales.test.js`
- Modify: `src/app/(dashboard)/dashboard/providers/[id]/page.js:1-1774`
- Modify: `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js:1-366`
- Modify: all 34 `public/i18n/literals/*.json` files listed by `fd -t f '\.json$' public/i18n/literals | sort`

**Interfaces:**
- Consumes: sanitized SSE, authenticated detail, compare-dismissal, recheck route, runtime `translate`, and the exact hook return shape above.
- Produces: one page-scoped EventSource, authoritative snapshot reconciliation, URL only in component memory, one matching row anchor, one explicit recheck button, accessible authorization failure, and 27 tests.
- Preserves: every current row prop, hot reload, auto-ping, proxy controls, edit, delete, toggle, settings queues, model discovery, provider navigation, and all non-Antigravity pages.

**Step group 1: Record the Phase 3 baseline**

- [ ] **Step 1a:** Re-run the clean-status and dependency assertions.
- [ ] **Step 1b:** Run the measured Phase 3 adjacency command from `tests/` and record 43 passed.

Run from `tests/`.

```bash
set -euo pipefail
./node_modules/.bin/vitest run unit/provider-quota-visibility.test.js unit/quota-auto-ping.test.js unit/provider-strategy-writers.test.js unit/commandcode-zdr-ui.test.js
```

Expected result is exactly 43 passed and zero failed.

**Step group 2: Write client transport RED and implement the page-scoped hook**

- [ ] **Step 2a:** Add disabled and authorized-preflight EventSource cases.
- [ ] **Step 2b:** Add snapshot, upsert, and matching-remove cases.
- [ ] **Step 2c:** Add expiry, detail failure, and access-denial cases.
- [ ] **Step 2d:** Add stop/navigation, stale-response, and exact recheck cases.
- [ ] **Step 2e:** Add authoritative snapshot removal, mismatch, old-detail invalidation, and reconnect-clearing cases.
- [ ] **Step 2f:** Run the client command and record the missing-module RED.
- [ ] **Step 2g:** Implement the dependency-injected controller and status-visible preflight.
- [ ] **Step 2h:** Implement sanitized event handling, exact detail reads, URL validation, and race checks.
- [ ] **Step 2i:** Implement authoritative snapshot reconciliation and one-source reconnect clearing.
- [ ] **Step 2j:** Implement expiry/error cleanup and exact recheck POST.
- [ ] **Step 2k:** Wrap the controller in one hook effect and run 16 GREEN tests.

Write 16 tests before creating the hook. Initial RED is one suite collection failure naming the missing module.

| Count | Exact client cases |
| ---: | --- |
| 2 | `enabled=false` performs no preflight and opens no EventSource; authorized `enabled=true` cancels one status-visible stream preflight body and then opens exactly one EventSource |
| 3 | snapshot fetches exact detail; upsert fetches exact detail; remove clears only matching challenge |
| 3 | expiry clears href; failed detail clears href; 401 or 403 from preflight or detail sets access denial and no href or EventSource |
| 2 | unmount or provider navigation closes source and timers; stale detail response cannot overwrite newer challenge |
| 2 | recheck sends same-origin JSON POST with exact challenge ID; it never uses GET, general usage, `window.open`, or `/api/usage/stream` |
| 4 | authoritative snapshot removes an absent local entry; mismatched snapshot challenge clears the old href and timer before replacement detail; every snapshot invalidates older detail promises even for the same challenge; stream error and reconnect clear all hrefs and timers while retaining exactly one EventSource and accepting the next authoritative snapshot |

Export a small dependency-injected client controller from the same file for Node tests. The React hook wraps it in one `useEffect`; no second store is introduced.

```js
createAntigravityVerificationClient({
  EventSourceImpl,
  fetchImpl,
  now,
  setTimeoutImpl,
  clearTimeoutImpl,
  onState,
}) -> { start(), stop(), recheck(connectionId) }
```

`start()` first performs a same-origin credentialed `fetch` to the dedicated stream URL so 401 and 403 remain observable. For 200 it immediately cancels the response body, waits for server cleanup, then creates one `EventSource` to that same URL. It never parses snapshot data from the preflight. For 401 or 403 it sets `accessDenied` and opens no EventSource. Other preflight failures expose only `Unable to load verification link`. This extra GET is read-only and never uses the general usage stream.

Client URL validation repeats the server rules, including UTF-8 and canonical href bounds, exact HTTPS host, empty normalized port, no credentials, no controls, and no surrounding whitespace. It is defense in depth only. State updates compare `connectionId`, `challengeId`, and the current detail-request epoch before applying a response.

Treat every SSE `snapshot` as the complete authoritative server set, never as a merge. Parse its sanitized entries into one new map. In one state transition, remove every local connection absent from the snapshot, remove every local entry whose challenge ID mismatches, clear those hrefs and expiry timers, increment the detail epoch for every prior entry, and then schedule exact detail reads for the snapshot entries. Even a same-ID and same-challenge snapshot invalidates a detail promise started before that snapshot. An older detail promise can never write after reconciliation.

The single EventSource is the only live stream source. Its `error` handler immediately invalidates every detail epoch, clears all hrefs and timers, and publishes URL-free empty state. It does not close and recreate the source. Native EventSource reconnect remains on that same object, and the next snapshot repopulates from one authoritative server source. Upserts and removes between snapshots remain exact deltas. Href, timers, preflight body, and pending state also disappear on expiry, remove, detail failure, navigation, and stop.

Run this command from `tests/` before and after hook implementation.

```bash
set -euo pipefail
./node_modules/.bin/vitest run unit/antigravity-verification-client.test.js
```

Initial RED is the named missing-module collection failure. GREEN is exactly 16 passed.

**Step group 3: Write rendered UI and locale RED**

- [ ] **Step 3a:** Add exact href, visible label, accessible name, and keyboard-focus row cases.
- [ ] **Step 3b:** Add recheck, hot-reload composition, connection isolation, and unauthorized-page cases.
- [ ] **Step 3c:** Run the UI file and record 8 failed.
- [ ] **Step 3d:** Add the exact catalog count and six-key inventory case.
- [ ] **Step 3e:** Add non-empty localization and French render/casing cases.
- [ ] **Step 3f:** Run the locale file and record 3 failed.

Write the 8 row tests before changing the row or page. Expected RED is exactly 8 failed. Each test supplies a verification prop, so none is a baseline-only pass.

| Count | Exact UI cases |
| ---: | --- |
| 1 | exact validated href, `target="_blank"`, and `rel="noopener noreferrer"` |
| 1 | visible translated required-state and action labels, never raw URL text |
| 1 | translated accessible name combines action and connection display name |
| 1 | anchor is keyboard focusable and has existing focus-visible style |
| 1 | explicit translated recheck button calls only the supplied callback |
| 1 | hot reload and verification controls render and remain enabled together |
| 1 | only the matching connection receives verification props |
| 1 | unauthorized provider-page state renders one translated accessible explanation and no anchor |

Use server rendering and a mocked non-English translation map.

```js
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/i18n/runtime", () => ({
  translate: (value) => ({
    "Verify Antigravity account": "Vérifier le compte Antigravity",
    "Check verification": "Vérifier la validation",
    "Sign in or use the local dashboard to verify Antigravity":
      "Connectez-vous ou utilisez le tableau de bord local pour vérifier Antigravity",
  }[value] || value),
}));
```

Write the 3 locale tests before editing catalogs. Expected RED is exactly 3 failed.

1. Exactly 34 catalog files exist and each contains all six keys.
2. Every value is a non-empty string, and French values for the action and recheck differ from English.
3. A mocked French render uses the localized accessible name and every new value preserves exact `Antigravity` spelling.

Run the UI test alone before row or page edits and record exactly 8 failed. Run the locale test alone before catalog edits and record exactly 3 failed.

```bash
set -euo pipefail
./node_modules/.bin/vitest run unit/antigravity-verification-ui.test.js
./node_modules/.bin/vitest run unit/antigravity-verification-locales.test.js
```

**Step group 4: Render the action without changing existing controls**

- [ ] **Step 4a:** Call the hook unconditionally with the exact `enabled` expression.
- [ ] **Step 4b:** Pass the exact matching row object and recheck closure below.
- [ ] **Step 4c:** Render one page-level translated access-denied status.
- [ ] **Step 4d:** Change only the row action container to wrapping flex and add the exact anchor.
- [ ] **Step 4e:** Add the explicit recheck control and bounded translated error states.
- [ ] **Step 4f:** Add all six reviewed translations to the first 17 catalogs.
- [ ] **Step 4g:** Add all six reviewed translations to the remaining 17 catalogs.
- [ ] **Step 4h:** Run the UI plus locale command and record 11 passed.

The page always calls `useAntigravityVerification({ enabled: providerId === "antigravity" })` at the top level so hook order is stable. For a matching record it passes this exact row prop; every other row receives `null`. Do not change current state queues or callback identities.

```jsx
verification={antigravityVerification.byConnectionId[conn.id] ? {
  ...antigravityVerification.byConnectionId[conn.id],
  onRecheck: () => antigravityVerification.recheck(conn.id),
} : null}
```

When `providerId === "antigravity" && antigravityVerification.accessDenied`, the page renders exactly one translated `role="status"` explanation above the connection list and passes no href to any row. Do not duplicate the explanation per connection.

The row action container changes from a fixed three-column grid to a wrapping flex layout. The new anchor sits beside current controls.

```jsx
<a
  href={verification.href}
  target="_blank"
  rel="noopener noreferrer"
  aria-label={`${translate("Verify Antigravity account")} ${displayName}`}
  className="flex flex-col items-center rounded px-2 py-1 text-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
>
  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">verified_user</span>
  <span className="text-[10px] leading-tight">{translate("Verify Antigravity account")}</span>
</a>
```

Opening does not mutate state. The adjacent button calls `verification.onRecheck`, displays `Check verification`, and disables only while that exact challenge is rechecking. Expired or invalid records render no anchor. Access denial renders the approved translated explanation with `role="status"` and no fallback link.

A matching live row also renders `Antigravity account verification required`. When a detail read fails or a local expiry fires, the hook removes `href` and exposes only the source key `Unable to load verification link` or `Verification link expired`; the row translates that bounded key and renders no anchor. It never renders a server error string or URL.

Add these exact source keys to every catalog, with reviewed language-appropriate values.

```text
Verify Antigravity account
Check verification
Antigravity account verification required
Sign in or use the local dashboard to verify Antigravity
Verification link expired
Unable to load verification link
```

Use the exact reviewed catalog values below. Columns A through F correspond to the six source keys above in the same order. Do not machine-regenerate or silently fall back to English.

| Catalog | A | B | C | D | E | F |
| --- | --- | --- | --- | --- | --- | --- |
| `ar.json` | التحقق من حساب Antigravity | التحقق من اكتمال التحقق | يلزم التحقق من حساب Antigravity | سجّل الدخول أو استخدم لوحة المعلومات المحلية للتحقق من Antigravity | انتهت صلاحية رابط التحقق | تعذر تحميل رابط التحقق |
| `bn.json` | Antigravity অ্যাকাউন্ট যাচাই করুন | যাচাইকরণ পরীক্ষা করুন | Antigravity অ্যাকাউন্ট যাচাইকরণ প্রয়োজন | Antigravity যাচাই করতে সাইন ইন করুন বা স্থানীয় ড্যাশবোর্ড ব্যবহার করুন | যাচাইকরণ লিঙ্কের মেয়াদ শেষ হয়েছে | যাচাইকরণ লিঙ্ক লোড করা যায়নি |
| `cs.json` | Ověřit účet Antigravity | Zkontrolovat ověření | Je vyžadováno ověření účtu Antigravity | Přihlaste se nebo k ověření Antigravity použijte místní řídicí panel | Platnost ověřovacího odkazu vypršela | Ověřovací odkaz se nepodařilo načíst |
| `da.json` | Bekræft Antigravity-konto | Kontrollér bekræftelse | Bekræftelse af Antigravity-konto er påkrævet | Log ind, eller brug det lokale kontrolpanel til at bekræfte Antigravity | Bekræftelseslinket er udløbet | Bekræftelseslinket kunne ikke indlæses |
| `de.json` | Antigravity-Konto bestätigen | Bestätigung prüfen | Bestätigung des Antigravity-Kontos erforderlich | Melden Sie sich an oder verwenden Sie das lokale Dashboard, um Antigravity zu bestätigen | Bestätigungslink ist abgelaufen | Bestätigungslink konnte nicht geladen werden |
| `el.json` | Επαλήθευση λογαριασμού Antigravity | Έλεγχος επαλήθευσης | Απαιτείται επαλήθευση λογαριασμού Antigravity | Συνδεθείτε ή χρησιμοποιήστε τον τοπικό πίνακα ελέγχου για να επαληθεύσετε το Antigravity | Ο σύνδεσμος επαλήθευσης έληξε | Δεν ήταν δυνατή η φόρτωση του συνδέσμου επαλήθευσης |
| `es.json` | Verificar cuenta de Antigravity | Comprobar verificación | Se requiere verificar la cuenta de Antigravity | Inicia sesión o usa el panel local para verificar Antigravity | El enlace de verificación ha caducado | No se pudo cargar el enlace de verificación |
| `fa.json` | تأیید حساب Antigravity | بررسی تأیید | تأیید حساب Antigravity الزامی است | برای تأیید Antigravity وارد شوید یا از داشبورد محلی استفاده کنید | پیوند تأیید منقضی شده است | بارگیری پیوند تأیید ممکن نشد |
| `fi.json` | Vahvista Antigravity-tili | Tarkista vahvistus | Antigravity-tili on vahvistettava | Kirjaudu sisään tai vahvista Antigravity paikallisessa hallintapaneelissa | Vahvistuslinkki on vanhentunut | Vahvistuslinkkiä ei voitu ladata |
| `fr.json` | Vérifier le compte Antigravity | Vérifier la validation | La vérification du compte Antigravity est requise | Connectez-vous ou utilisez le tableau de bord local pour vérifier Antigravity | Le lien de vérification a expiré | Impossible de charger le lien de vérification |
| `he.json` | אימות חשבון Antigravity | בדיקת האימות | נדרש אימות של חשבון Antigravity | יש להתחבר או להשתמש בלוח הבקרה המקומי כדי לאמת את Antigravity | פג תוקפו של קישור האימות | לא ניתן לטעון את קישור האימות |
| `hi.json` | Antigravity खाते की पुष्टि करें | पुष्टि की जाँच करें | Antigravity खाते की पुष्टि आवश्यक है | Antigravity की पुष्टि करने के लिए साइन इन करें या स्थानीय डैशबोर्ड का उपयोग करें | पुष्टि लिंक की समय-सीमा समाप्त हो गई | पुष्टि लिंक लोड नहीं हो सका |
| `hu.json` | Antigravity-fiók ellenőrzése | Ellenőrzés vizsgálata | Az Antigravity-fiók ellenőrzése szükséges | Jelentkezzen be, vagy használja a helyi irányítópultot az Antigravity ellenőrzéséhez | Az ellenőrző hivatkozás lejárt | Az ellenőrző hivatkozás nem tölthető be |
| `id.json` | Verifikasi akun Antigravity | Periksa verifikasi | Verifikasi akun Antigravity diperlukan | Masuk atau gunakan dasbor lokal untuk memverifikasi Antigravity | Tautan verifikasi telah kedaluwarsa | Tautan verifikasi tidak dapat dimuat |
| `it.json` | Verifica account Antigravity | Controlla verifica | È richiesta la verifica dell'account Antigravity | Accedi o usa la dashboard locale per verificare Antigravity | Il link di verifica è scaduto | Impossibile caricare il link di verifica |
| `ja.json` | Antigravity アカウントを確認 | 確認状況をチェック | Antigravity アカウントの確認が必要です | Antigravity を確認するには、サインインするかローカルダッシュボードを使用してください | 確認リンクの有効期限が切れました | 確認リンクを読み込めませんでした |
| `km.json` | ផ្ទៀងផ្ទាត់គណនី Antigravity | ពិនិត្យការផ្ទៀងផ្ទាត់ | តម្រូវឱ្យផ្ទៀងផ្ទាត់គណនី Antigravity | ចូលគណនី ឬប្រើផ្ទាំងគ្រប់គ្រងក្នុងម៉ាស៊ីន ដើម្បីផ្ទៀងផ្ទាត់ Antigravity | តំណផ្ទៀងផ្ទាត់បានផុតកំណត់ | មិនអាចផ្ទុកតំណផ្ទៀងផ្ទាត់បានទេ |
| `ko.json` | Antigravity 계정 확인 | 확인 상태 점검 | Antigravity 계정 확인이 필요합니다 | Antigravity를 확인하려면 로그인하거나 로컬 대시보드를 사용하세요 | 확인 링크가 만료되었습니다 | 확인 링크를 불러올 수 없습니다 |
| `nl.json` | Antigravity-account verifiëren | Verificatie controleren | Verificatie van het Antigravity-account is vereist | Meld u aan of gebruik het lokale dashboard om Antigravity te verifiëren | Verificatielink is verlopen | Verificatielink kan niet worden geladen |
| `no.json` | Bekreft Antigravity-konto | Kontroller bekreftelse | Bekreftelse av Antigravity-konto er påkrevd | Logg inn eller bruk det lokale kontrollpanelet for å bekrefte Antigravity | Bekreftelseslenken er utløpt | Bekreftelseslenken kunne ikke lastes |
| `pl.json` | Zweryfikuj konto Antigravity | Sprawdź weryfikację | Wymagana jest weryfikacja konta Antigravity | Zaloguj się lub użyj lokalnego panelu, aby zweryfikować Antigravity | Link weryfikacyjny wygasł | Nie udało się wczytać linku weryfikacyjnego |
| `pt-BR.json` | Verificar conta do Antigravity | Verificar validação | É necessário verificar a conta do Antigravity | Entre ou use o painel local para verificar o Antigravity | O link de verificação expirou | Não foi possível carregar o link de verificação |
| `pt-PT.json` | Verificar conta do Antigravity | Verificar validação | É necessário verificar a conta do Antigravity | Inicie sessão ou use o painel local para verificar o Antigravity | A ligação de verificação expirou | Não foi possível carregar a ligação de verificação |
| `ro.json` | Verifică contul Antigravity | Verifică validarea | Este necesară verificarea contului Antigravity | Autentifică-te sau folosește panoul local pentru a verifica Antigravity | Linkul de verificare a expirat | Linkul de verificare nu a putut fi încărcat |
| `ru.json` | Подтвердить учетную запись Antigravity | Проверить подтверждение | Требуется подтверждение учетной записи Antigravity | Войдите или используйте локальную панель, чтобы подтвердить Antigravity | Срок действия ссылки для подтверждения истек | Не удалось загрузить ссылку для подтверждения |
| `sv.json` | Verifiera Antigravity-konto | Kontrollera verifiering | Verifiering av Antigravity-kontot krävs | Logga in eller använd den lokala kontrollpanelen för att verifiera Antigravity | Verifieringslänken har gått ut | Verifieringslänken kunde inte läsas in |
| `th.json` | ยืนยันบัญชี Antigravity | ตรวจสอบการยืนยัน | ต้องยืนยันบัญชี Antigravity | ลงชื่อเข้าใช้หรือใช้แดชบอร์ดภายในเครื่องเพื่อยืนยัน Antigravity | ลิงก์ยืนยันหมดอายุแล้ว | ไม่สามารถโหลดลิงก์ยืนยันได้ |
| `tl.json` | I-verify ang Antigravity account | Suriin ang verification | Kailangan ang verification ng Antigravity account | Mag-sign in o gamitin ang lokal na dashboard para i-verify ang Antigravity | Nag-expire na ang verification link | Hindi ma-load ang verification link |
| `tr.json` | Antigravity hesabını doğrula | Doğrulamayı kontrol et | Antigravity hesabının doğrulanması gerekiyor | Antigravity'yi doğrulamak için oturum açın veya yerel kontrol panelini kullanın | Doğrulama bağlantısının süresi doldu | Doğrulama bağlantısı yüklenemedi |
| `uk.json` | Підтвердити обліковий запис Antigravity | Перевірити підтвердження | Потрібне підтвердження облікового запису Antigravity | Увійдіть або скористайтеся локальною панеллю, щоб підтвердити Antigravity | Термін дії посилання для підтвердження минув | Не вдалося завантажити посилання для підтвердження |
| `ur.json` | Antigravity اکاؤنٹ کی تصدیق کریں | تصدیق کی جانچ کریں | Antigravity اکاؤنٹ کی تصدیق درکار ہے | Antigravity کی تصدیق کے لیے سائن ان کریں یا مقامی ڈیش بورڈ استعمال کریں | تصدیقی لنک کی میعاد ختم ہو گئی ہے | تصدیقی لنک لوڈ نہیں ہو سکا |
| `vi.json` | Xác minh tài khoản Antigravity | Kiểm tra xác minh | Cần xác minh tài khoản Antigravity | Đăng nhập hoặc dùng bảng điều khiển cục bộ để xác minh Antigravity | Liên kết xác minh đã hết hạn | Không thể tải liên kết xác minh |
| `zh-CN.json` | 验证 Antigravity 账号 | 检查验证状态 | 需要验证 Antigravity 账号 | 请登录或使用本地控制面板验证 Antigravity | 验证链接已过期 | 无法加载验证链接 |
| `zh-TW.json` | 驗證 Antigravity 帳號 | 檢查驗證狀態 | 需要驗證 Antigravity 帳號 | 請登入或使用本機控制台驗證 Antigravity | 驗證連結已過期 | 無法載入驗證連結 |

Run both suites from `tests/`. Expected GREEN is exactly 11 passed.

```bash
set -euo pipefail
./node_modules/.bin/vitest run unit/antigravity-verification-ui.test.js unit/antigravity-verification-locales.test.js
```

**Step group 5: Run Phase 3 GREEN, static gates, and review gate**

- [ ] **Step 5a:** Run the exact 255-test combined command below from `tests/`.
- [ ] **Step 5b:** Run Phase 3 ESLint from the worktree root.
- [ ] **Step 5c:** Parse all 34 JSON catalogs and run `git diff --check`.
- [ ] **Step 5d:** Run the forbidden client-integration search and require empty output.
- [ ] **Step 5e:** Request a fresh Phase 3 review and resolve every Critical or Important finding.

Run all 13 feature files from Phases 1 through 3 plus the measured 43-test UI adjacency list from `tests/`. Expected result is exactly 255 passed and zero failed.

```bash
set -euo pipefail
./node_modules/.bin/vitest run \
  unit/antigravity-validation.test.js \
  unit/antigravity-project-outcome.test.js \
  unit/antigravity-usage-validation.test.js \
  unit/antigravity-retry-response.test.js \
  unit/antigravity-terminal-verification.test.js \
  unit/antigravity-verification-state.test.js \
  unit/antigravity-verification-access.test.js \
  unit/antigravity-verification-routes.test.js \
  unit/antigravity-verification-callers.test.js \
  unit/antigravity-verification-privacy.test.js \
  unit/antigravity-verification-client.test.js \
  unit/antigravity-verification-ui.test.js \
  unit/antigravity-verification-locales.test.js \
  unit/provider-quota-visibility.test.js \
  unit/quota-auto-ping.test.js \
  unit/provider-strategy-writers.test.js \
  unit/commandcode-zdr-ui.test.js
```

Run from the worktree root.

```bash
set -euo pipefail
./node_modules/.bin/eslint 'src/app/(dashboard)/dashboard/providers/[id]/useAntigravityVerification.js' 'src/app/(dashboard)/dashboard/providers/[id]/page.js' 'src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js' tests/unit/antigravity-verification-client.test.js tests/unit/antigravity-verification-ui.test.js tests/unit/antigravity-verification-locales.test.js
node --input-type=module -e 'import fs from "node:fs"; import path from "node:path"; const dir="public/i18n/literals"; const files=fs.readdirSync(dir).filter((f)=>f.endsWith(".json")).sort(); if(files.length!==34) throw new Error(`expected 34 catalogs, got ${files.length}`); for(const file of files) JSON.parse(fs.readFileSync(path.join(dir,file),"utf8"));'
git diff --check
```

Search forbidden client integration.

```bash
set -euo pipefail
if rg -n 'api/usage/stream|window\.open|DashboardLayout|UsageStats|zustand' 'src/app/(dashboard)/dashboard/providers/[id]/useAntigravityVerification.js' 'src/app/(dashboard)/dashboard/providers/[id]/page.js' 'src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js'; then
  exit 1
fi
```

Expected output is empty. Request a fresh Phase 3 review. Stop on any Critical or Important finding.

- [ ] **Step 6: Commit Phase 3**

Stage the three code files, three tests, and the exact catalog set. Use the explicit generated file list only after verifying it contains 34 paths.

```bash
set -euo pipefail
pr3635_locale_files="$(fd -t f '\.json$' public/i18n/literals | sort)"
test "$(printf '%s\n' "$pr3635_locale_files" | sed '/^$/d' | wc -l)" -eq 34
printf '%s\n' "$pr3635_locale_files"
git add 'src/app/(dashboard)/dashboard/providers/[id]/useAntigravityVerification.js' 'src/app/(dashboard)/dashboard/providers/[id]/page.js' 'src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js' tests/unit/antigravity-verification-client.test.js tests/unit/antigravity-verification-ui.test.js tests/unit/antigravity-verification-locales.test.js public/i18n/literals/ar.json public/i18n/literals/bn.json public/i18n/literals/cs.json public/i18n/literals/da.json public/i18n/literals/de.json public/i18n/literals/el.json public/i18n/literals/es.json public/i18n/literals/fa.json public/i18n/literals/fi.json public/i18n/literals/fr.json public/i18n/literals/he.json public/i18n/literals/hi.json public/i18n/literals/hu.json public/i18n/literals/id.json public/i18n/literals/it.json public/i18n/literals/ja.json public/i18n/literals/km.json public/i18n/literals/ko.json public/i18n/literals/nl.json public/i18n/literals/no.json public/i18n/literals/pl.json public/i18n/literals/pt-BR.json public/i18n/literals/pt-PT.json public/i18n/literals/ro.json public/i18n/literals/ru.json public/i18n/literals/sv.json public/i18n/literals/th.json public/i18n/literals/tl.json public/i18n/literals/tr.json public/i18n/literals/uk.json public/i18n/literals/ur.json public/i18n/literals/vi.json public/i18n/literals/zh-CN.json public/i18n/literals/zh-TW.json
git commit -m "feat(antigravity): add verification action"
test "$(git log -1 --format=%s)" = "feat(antigravity): add verification action"
test -z "$(git status --porcelain)"
```

Expected subject is exactly `feat(antigravity): add verification action`. Worktree must be clean before Task 4.

---

## Task 4: Verify the complete feature and isolated real path

**Files:**
- Modify: none
- Test: all feature, repository, build, route, browser, and credentialed probe paths

**Interfaces:**
- Consumes: the three reviewed implementation commits.
- Produces: fresh full-suite JSON, no-regression receipt, build receipt, browser receipt, and redacted credentialed probe receipt.
- Preserves: a clean worktree. Any generated churn triggers the stop rule and coordinator handoff.

**Step group 1: Verify exact scope and exclusions**

- [ ] **Step 1a:** Verify clean status and the exact four-commit history.
- [ ] **Step 1b:** Inspect the complete name-only scope and run `git diff --check`.
- [ ] **Step 1c:** Run the exact excluded-path diff and require exit 0.

Run from the worktree root.

```bash
set -euo pipefail
git status --short --branch
test -z "$(git status --porcelain)"
test "$(git log -1 --format=%s)" = "feat(antigravity): add verification action"
test "$(git log -1 --skip=1 --format=%s)" = "feat(antigravity): secure account verification"
test "$(git log -1 --skip=2 --format=%s)" = "feat(antigravity): classify account verification"
test "$(git log -1 --skip=3 --format=%s)" = "docs(antigravity): fix verification implementation plan"
git log --oneline -4
git diff --name-only 9d8193182..HEAD
git diff --check 9d8193182..HEAD
git diff --exit-code 9d8193182..HEAD -- open-sse/providers/shared.js open-sse/config/appConstants.js src/dashboardGuard.js src/lib/db/repos/usageRepo.js src/lib/usageDb.js src/app/api/usage/stream/route.js src/shared/components/UsageStats.js src/shared/components/layouts/DashboardLayout.js package.json package-lock.json
```

Expected history is the exact corrected-plan subject `docs(antigravity): fix verification implementation plan` followed by the three exact implementation subjects asserted above. The excluded-path diff exits 0. Porcelain is empty.

**Step group 2: Run the 212 feature tests and all measured adjacency**

- [ ] **Step 2a:** Run the exact 212-test feature command below from `tests/`.
- [ ] **Step 2b:** Re-run Phase 1 adjacency and require 98 passed.
- [ ] **Step 2c:** Re-run Phase 2 adjacency and require 104 passed.
- [ ] **Step 2d:** Re-run Phase 3 adjacency and require 43 passed.

Run the 13 new feature files from `tests/`.

```bash
set -euo pipefail
./node_modules/.bin/vitest run \
  unit/antigravity-validation.test.js \
  unit/antigravity-project-outcome.test.js \
  unit/antigravity-usage-validation.test.js \
  unit/antigravity-retry-response.test.js \
  unit/antigravity-terminal-verification.test.js \
  unit/antigravity-verification-state.test.js \
  unit/antigravity-verification-access.test.js \
  unit/antigravity-verification-routes.test.js \
  unit/antigravity-verification-callers.test.js \
  unit/antigravity-verification-privacy.test.js \
  unit/antigravity-verification-client.test.js \
  unit/antigravity-verification-ui.test.js \
  unit/antigravity-verification-locales.test.js
```

Expected result is exactly 212 passed and zero failed. Then run each phase adjacency command from its documented `tests/` cwd. Phase totals remain 189, 289, and 255 as documented.

**Step group 3: Run full repository no-regression verification**

- [ ] **Step 3a:** Run full Vitest JSON output to the exact `/tmp` path.
- [ ] **Step 3b:** Run the repository no-regression verifier against that JSON.
- [ ] **Step 3c:** Assert exact 3,710 total, 60 failed, and 57 pending counts.
- [ ] **Step 3d:** Check worktree status and stop on any generated churn.

From `tests/`, write JSON only under `/tmp`.

```bash
set -euo pipefail
set +e
./node_modules/.bin/vitest run --reporter=json --outputFile=/tmp/9router-pr3635-results.json
PR3635_VITEST_EXIT=$?
set -e
test "$PR3635_VITEST_EXIT" -eq 1
node __baseline__/verify-no-regression.mjs /tmp/9router-pr3635-results.json
node --input-type=module -e 'import fs from "node:fs"; const r=JSON.parse(fs.readFileSync("/tmp/9router-pr3635-results.json","utf8")); if(r.numTotalTests!==3710) throw new Error(`expected 3710 tests, got ${r.numTotalTests}`); if(r.numFailedTests!==60) throw new Error(`expected 60 known failures, got ${r.numFailedTests}`); if(r.numPendingTests!==57) throw new Error(`expected 57 pending, got ${r.numPendingTests}`);'
test -z "$(git status --porcelain)"
```

The Vitest command must exit 1 because the 60 known failures remain. Any other exit code stops the plan. Expected verifier output reports no regression with 60 current failures. Immediately run `git status --short`. If any generated or unowned file changed, stop and return to the coordinator without editing, reverting, or staging it.

**Step group 4: Run final static and production build gates**

- [ ] **Step 4a:** Run the complete changed-file ESLint command.
- [ ] **Step 4b:** Run the production build and inspect all three route files and four methods.
- [ ] **Step 4c:** Run `git diff --check` and require clean status.

From the worktree root.

```bash
set -euo pipefail
./node_modules/.bin/eslint open-sse/services/antigravityValidation.js open-sse/executors/antigravity.js open-sse/services/projectId.js open-sse/services/usage/google.js open-sse/services/usage.js open-sse/utils/error.js open-sse/handlers/chatCore.js open-sse/handlers/chatCore/nonStreamingHandler.js open-sse/handlers/chatCore/sseToJsonHandler.js open-sse/handlers/chatCore/streamingHandler.js src/lib/antigravityVerification.js src/lib/auth/antigravityVerificationAccess.js src/sse/handlers/chat.js src/sse/services/tokenRefresh.js src/sse/services/quotaGuard.js 'src/app/api/providers/[id]/hotreload/route.js' 'src/app/api/usage/[connectionId]/route.js' 'src/app/api/providers/[id]/route.js' src/app/api/providers/antigravity/verification/stream/route.js 'src/app/api/providers/antigravity/verification/[connectionId]/route.js' 'src/app/api/providers/antigravity/verification/[connectionId]/recheck/route.js' 'src/app/(dashboard)/dashboard/providers/[id]/useAntigravityVerification.js' 'src/app/(dashboard)/dashboard/providers/[id]/page.js' 'src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js' tests/fixtures/antigravity-verification-access.js tests/unit/antigravity-validation.test.js tests/unit/antigravity-project-outcome.test.js tests/unit/antigravity-usage-validation.test.js tests/unit/antigravity-retry-response.test.js tests/unit/antigravity-terminal-verification.test.js tests/unit/antigravity-verification-state.test.js tests/unit/antigravity-verification-access.test.js tests/unit/antigravity-verification-routes.test.js tests/unit/antigravity-verification-callers.test.js tests/unit/antigravity-verification-privacy.test.js tests/unit/antigravity-verification-client.test.js tests/unit/antigravity-verification-ui.test.js tests/unit/antigravity-verification-locales.test.js
npm run build
git diff --check
git status --short
test -z "$(git status --porcelain)"
```

Expected ESLint has no new warning, the production build exits 0, and the build reports the three new dynamic route files covering four methods. The worktree remains clean.

**Step group 5: Run isolated server and browser gates without touching live ports**

- [ ] **Step 5a:** Allocate the exact temporary directory, install the cleanup trap, and create the SQLite backup.
- [ ] **Step 5b:** Disable login in the copy, strip copied refresh tokens, and select an eligible non-refreshing connection.
- [ ] **Step 5c:** Start only the isolated tmux server with fresh JWT secret and disabled background refresh.
- [ ] **Step 5d:** Prove only port 29135 is the target and the dashboard responds.
- [ ] **Step 5e:** Complete the direct-loopback browser baseline and capture rendered/a11y/network evidence.
- [ ] **Step 5f:** Complete the proxied unauthenticated browser denial and capture the translated status.

Do not use `scripts/dev-test-server.sh`; it hardcodes occupied port 20129. Use loopback port 29135 and a SQLite online backup of the live database so all test writes stay isolated. Disable proactive refresh and remove refresh tokens from the copy before boot. This prevents the isolated server from rotating an external OAuth refresh token that the live database still owns.

Run every Bash fence in Task 4 Step groups 5 through 7 sequentially in the same fail-fast shell rooted at the worktree. They intentionally share the exported variables, cleanup function, and traps established below. Do not close that shell until Step 7 completes or an error invokes the EXIT trap.

Set task-specific environment in the executing shell.

```bash
set -euo pipefail
export PR3635_DATA_DIR PR3635_CONNECTION_ID PR3635_JWT_SECRET
PR3635_DATA_DIR=$(mktemp -d /tmp/9router-pr3635-verification.XXXXXX)
PR3635_JWT_SECRET=$(openssl rand -hex 32)
cleanup_pr3635_verification() {
  if tmux has-session -t 9router-pr3635-verification 2>/dev/null; then
    tmux kill-session -t 9router-pr3635-verification
  fi
  if test -d "$PR3635_DATA_DIR"; then
    case "$PR3635_DATA_DIR" in /tmp/9router-pr3635-verification.*) ;; *) return 2 ;; esac
    rm -r -- "$PR3635_DATA_DIR"
  fi
}
trap cleanup_pr3635_verification EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$PR3635_DATA_DIR/db"
sqlite3 /home/spadon/.9router/db/data.sqlite ".backup '$PR3635_DATA_DIR/db/data.sqlite'"
PR3635_CONNECTION_ID=$(DATA_DIR="$PR3635_DATA_DIR" node --input-type=module -e 'const db=await import("./src/lib/db/index.js"); await db.updateSettings({requireLogin:false}); const rows=await db.getProviderConnections(); for(const row of rows){if(row.refreshToken) await db.updateProviderConnection(row.id,{refreshToken:null});} const eligible=rows.find((row)=>row.provider==="antigravity"&&row.isActive&&row.accessToken&&Number.isFinite(Date.parse(row.expiresAt))&&Date.parse(row.expiresAt)-Date.now()>30*60*1000); if(eligible) process.stdout.write(`PR3635_ID=${eligible.id}\n`);' | sed -n 's/^PR3635_ID=//p')
tmux new-session -d -s 9router-pr3635-verification -c /home/spadon/Codebases/9router/.claude/worktrees/task-6-pr3635 "env DATA_DIR='$PR3635_DATA_DIR' JWT_SECRET='$PR3635_JWT_SECRET' DISABLE_BACKGROUND_TOKEN_REFRESH=1 AUTH_COOKIE_SECURE=false PORT=29135 HOSTNAME=127.0.0.1 node .next/standalone/custom-server.js"
```

Confirm the isolated process and never act on 20127 through 20129.

```bash
set -euo pipefail
curl -q -sS --retry 20 --retry-connrefused --retry-delay 1 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:29135/dashboard
ss -ltnp 'sport = :29135'
```

Use the managed browser against `http://127.0.0.1:29135/dashboard/providers/antigravity`. The isolated copy deliberately has `requireLogin=false`; direct loopback access must pass only through the trusted-peer exception. For the unauthorized pass, create a fresh browser context that sends `x-forwarded-for: 198.51.100.8`; the custom wrapper must stamp it as proxied, ordinary no-login dashboard HTML remains available, and the sensitive preflight must return 401. Verify all of the following in the rendered page, accessibility tree, console, and network panel.

Complete items 1 through 4 on the unchallenged page. Complete items 5 through 9 after Step 6 records a real challenge; do not fabricate one for browser evidence.

1. Existing hot reload, proxy, edit, delete, toggle, model discovery, settings, and queues still render and remain usable. Exercise local-only controls. Do not run a destructive provider action or a non-selected credential probe.
2. Exactly one verification EventSource exists on the Antigravity page and none exists after navigating away.
3. No request targets `/api/usage/stream` because of this feature.
4. Unauthorized detail returns no href and renders the translated status explanation.
5. A challenged matching connection renders one focusable translated anchor and one explicit recheck button. Any other connection present does not.
6. The anchor has exact `_blank` and `noopener noreferrer`, displays no raw URL, and navigating it sends no dashboard referrer.
7. Recheck is POST JSON with same-origin Origin and `Sec-Fetch-Site: same-origin`. No GET mutation occurs.
8. Dismissal, navigation, route failure, and unmount remove the href from component state. The fake-clock client test is the authoritative ten-minute browser-expiry gate.
9. Console has no URL, query token, unhandled rejection, hydration error, or accessibility error.

Save screenshot, accessibility, console, and network receipts outside Git under `/tmp/9router-pr3635-browser/`. Receipts must redact href and query values.

**Step group 6: Run the credentialed Antigravity probe and clear only the matching challenge**

- [ ] **Step 6a:** Run one forced exact-connection usage attempt without printing its response.
- [ ] **Step 6b:** Validate authenticated detail by piping it directly to the URL boolean.
- [ ] **Step 6c:** Capture only the challenge ID, compare-dismiss it, and verify the row remains.
- [ ] **Step 6d:** Run one new usage observation and verify the new matching row action.
- [ ] **Step 6e:** Open the anchor explicitly, complete Google validation, and invoke recheck.
- [ ] **Step 6f:** Record only the seven approved receipt facts and classify the live gate as pass or unavailable.

Use the eligible Antigravity connection selected before boot without printing email or tokens. Its access token had more than 30 minutes remaining when selected, and every copied refresh token is absent. Direct loopback requests authenticate through the tested trusted-peer no-login exception. Use the existing usage operation with `force=1` to provoke the real structured response. Never print the connection row or detail JSON.

```bash
set -euo pipefail
test -n "$PR3635_CONNECTION_ID"
curl -q -sS "http://127.0.0.1:29135/api/usage/$PR3635_CONNECTION_ID?force=1" | jq -e 'type == "object"' >/dev/null
```

The probe succeeds only if it records these URL-free facts.

```text
classification source
first 8 characters of connection ID
challenge ID
expiry timestamp
row action present
retry outcome
clear outcome
```

Fetch detail through the authenticated route and pipe it directly to a boolean validator that prints only `true`.

```bash
set -euo pipefail
curl -q -sS "http://127.0.0.1:29135/api/providers/antigravity/verification/$PR3635_CONNECTION_ID" | jq -e '.href | type == "string" and startswith("https://accounts.google.com/") and (utf8bytelength <= 8192)'
```

Exercise compare-dismissal once without printing detail. The browser must lose the anchor through the sanitized remove event, while the copied provider row remains. Then run one new usage attempt so a new observation can create a new challenge for the real completion path.

```bash
set -euo pipefail
export PR3635_CHALLENGE_ID
PR3635_CHALLENGE_ID=$(curl -q -sS "http://127.0.0.1:29135/api/providers/antigravity/verification/$PR3635_CONNECTION_ID" | jq -r '.challengeId')
test -n "$PR3635_CHALLENGE_ID"
test "$(jq -nc --arg challengeId "$PR3635_CHALLENGE_ID" '{challengeId:$challengeId}' | curl -q -sS -o /dev/null -w '%{http_code}' -X DELETE -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:29135' -H 'Sec-Fetch-Site: same-origin' --data-binary @- "http://127.0.0.1:29135/api/providers/antigravity/verification/$PR3635_CONNECTION_ID")" = "204"
curl -q -sS "http://127.0.0.1:29135/api/usage/$PR3635_CONNECTION_ID?force=1" | jq -e 'type == "object"' >/dev/null
```

Open the newly rendered anchor in the managed browser, complete the Google-hosted validation, then click `Check verification`. A usable quota response must remove only the submitted challenge. A repeated structured challenge must produce a new challenge ID and `{ verified: false }`. Any other failure leaves the prior challenge visible and returns a sanitized non-200 response.

If no copied connection currently receives a real `VALIDATION_REQUIRED` response, this live gate is unavailable, not passed. Record the missing external condition, run Step 7 cleanup, then report it. Do not fabricate state or weaken the gate.

**Step group 7: Stop only the isolated instance and finish clean**

- [ ] **Step 7a:** Verify the exact tmux target name.
- [ ] **Step 7b:** Run the trapped cleanup, disable the trap, and prove the temporary database is gone.
- [ ] **Step 7c:** Verify clean branch status and the final implementation commit.

Verify the tmux target before stopping it.

```bash
set -euo pipefail
tmux list-sessions -F '#{session_name}' | rg '^9router-pr3635-verification$'
cleanup_pr3635_verification
trap - EXIT INT TERM
test ! -e "$PR3635_DATA_DIR"
git status --short --branch
test -z "$(git status --porcelain)"
test "$(git log -1 --format=%s)" = "feat(antigravity): add verification action"
```

Run this cleanup step even when a browser or credentialed probe gate fails. Expected final state is a clean `integration/task6-pr3635`, three reviewed implementation commits after the corrected-plan commit, all deterministic gates green, production build green, browser evidence complete, and a redacted real-path receipt or an explicitly unavailable credentialed gate. Do not push or deploy from this plan.
