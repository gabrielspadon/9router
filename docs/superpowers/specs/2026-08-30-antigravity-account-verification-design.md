# Antigravity account verification design

**Date:** 2026-08-30
**Status:** Approved for implementation planning
**Upstream input:** PR #3635 at `3f75dac1e4d67664955eeff4b189a37d374929c9`
**Fork base:** `bbf75669add13559c6ec48a02e5af009c2104549`

## Objective

Adapt only the useful behavior from upstream PR #3635. 9Router will recognize
authoritative Google `VALIDATION_REQUIRED` challenges for Antigravity, associate
each challenge with the exact provider connection that received it, and expose
an ephemeral verification action on that connection's row. After the user opens
the verification page, they explicitly recheck the connection.

The implementation must not merge or cherry-pick the upstream patch. It must
not publish action URLs through usage data, process globals, request logs,
public error JSON, or dashboard-wide state. It must also preserve the fork's
current Antigravity request fingerprint, image behavior, retry architecture,
quota hot reload, and dashboard authorization model.

## Accepted scope

The adaptation retains three behaviors.

1. Strict classification of official structured validation responses.
2. Connection-scoped, short-lived delivery of a validated action URL.
3. Generic replacement of an original 401 or 403 response with the complete
   post-refresh retry result, whether that retry is successful or another HTTP
   error.

Everything else in PR #3635 is rejected or superseded. In particular, there is
no global dashboard banner, general usage SSE field, usage-repository state,
database migration, restored quota service, new executor fingerprint header,
or broad permissive parser.

## Primary-source contract

The classifier follows Google Gemini CLI commit
[`0bd1d439`](https://github.com/google-gemini/gemini-cli/commit/0bd1d439751478771c45d3d0895a6a9760554bf4).
The pinned source establishes both accepted shapes.

- [`setup.ts`](https://github.com/google-gemini/gemini-cli/blob/0bd1d439751478771c45d3d0895a6a9760554bf4/packages/core/src/code_assist/setup.ts#L305-L327)
  accepts a successful `loadCodeAssist` result only when `currentTier` is absent
  and an `ineligibleTiers` entry has both `reasonCode` equal to
  `VALIDATION_REQUIRED` and a `validationUrl`.
- [`googleQuotaErrors.ts`](https://github.com/google-gemini/gemini-cli/blob/0bd1d439751478771c45d3d0895a6a9760554bf4/packages/core/src/utils/googleQuotaErrors.ts#L114-L187)
  accepts an HTTP 403 only when the first `google.rpc.ErrorInfo` detail has an
  allowlisted Cloud Code domain and exact `VALIDATION_REQUIRED` reason. It uses
  the first link of the first `google.rpc.Help` detail, with
  `ErrorInfo.metadata.validation_link` as the fallback when no Help link exists.
- [`types.ts`](https://github.com/google-gemini/gemini-cli/blob/0bd1d439751478771c45d3d0895a6a9760554bf4/packages/core/src/code_assist/types.ts#L77-L133)
  defines the exact ineligible-tier field names and reason enum.

The allowed ErrorInfo domains are exactly these three strings.

```text
cloudcode-pa.googleapis.com
staging-cloudcode-pa.googleapis.com
autopush-cloudcode-pa.googleapis.com
```

No message substring, raw-text URL search, hostname alone, root-level URL,
`appeal_url`, loosely named metadata field, or non-403 error establishes a
challenge.

## Threat model

The verification URL is a credential-like action link. Its opaque query values
may grant access to an account-validation workflow. The design protects against
five concrete threats.

1. A malicious or compromised upstream can place an `accounts.google.com` URL
   inside an unrelated response. Structured status, type, domain, and reason
   checks prevent hostname-only trust.
2. A remote user can read normal dashboard usage APIs when `requireLogin` is
   disabled. Dedicated route authorization prevents this setting from exposing
   the verification URL.
3. Logs, request details, error bodies, usage snapshots, referrers, caches, or
   localization telemetry can retain the URL. Redaction and no-store delivery
   keep it out of those paths.
4. Parallel requests can overwrite or clear the wrong challenge. Monotonic
   generations and compare-and-clear operations preserve the latest event.
5. Stale or attacker-shaped URLs can survive indefinitely or trigger unsafe
   navigation. Strict URL validation, a ten-minute TTL, bounded entries,
   connection deletion cleanup, and restart-empty storage limit impact.

The design does not claim that the Google-hosted page itself is harmless. It
only proves that the link came from the currently documented Google response
contract and that navigation requires an explicit user action.

## Strict classifier

Add a pure provider-engine module at
`open-sse/services/antigravityValidation.js`. It has no import from `src`, no
database access, no mutable app state, and no logging side effect. Its public
surface is limited to the following responsibilities.

```js
classifyAntigravityValidation({ status, payload, source })
validateAntigravityVerificationUrl(candidate)
redactAntigravityValidationText(text)
```

`source` is one of `loadCodeAssist`, `onboardUser`, `usage`, or `chat`. A
successful ineligible-tier shape is accepted only for `source: loadCodeAssist`,
an HTTP success status, absent `currentTier`, and a matching entry in
`ineligibleTiers`. An RPC error shape is accepted for any Antigravity source
only when the HTTP status is exactly 403. If `error.code` is present, it must
also be 403.

For a 403, the first detail whose `@type` is exactly
`type.googleapis.com/google.rpc.ErrorInfo` is authoritative. Its `domain` must
exactly equal one of the three Cloud Code domains and its `reason` must exactly
equal `VALIDATION_REQUIRED`. The classifier does not trim, sanitize, or loosely
match either field. It then reads the first link of the first detail whose
`@type` is exactly `type.googleapis.com/google.rpc.Help`. It does not scan later
links. Only when that first Help link is absent may it use
`ErrorInfo.metadata.validation_link`. If the selected candidate fails URL
validation, classification fails rather than trying a lower-priority field.

The successful return is an internal value with this shape.

```js
{
  kind: "antigravity_validation_required",
  url: "https://accounts.google.com/...",
  source: "chat"
}
```

The URL validator applies all of these checks to both structured response
paths.

- Input is a string whose UTF-8 encoding is between 1 and 8,192 bytes.
- Input has no C0 control character or DEL and equals its trimmed form.
- `new URL(candidate)` succeeds.
- Protocol is exactly `https:`.
- Hostname is exactly `accounts.google.com`, with no trailing dot or subdomain.
- Port is empty after URL normalization, which permits only the default HTTPS
  port, including an explicit `:443`.
- Username and password are empty.
- The canonical `URL.href` also remains within the 8,192-byte bound.

The path, query, and fragment remain opaque. They are never inspected,
decoded, copied into messages, or used as authority. The browser repeats the
same checks as defense in depth, but the server validator is the trust boundary.

The redactor is not a classifier. It replaces values under
`validationUrl`, `validation_url`, and `validation_link`, and URLs inside Help
details associated with a structured validation error. It also removes any
`https://accounts.google.com/...` token from malformed text before the existing
200-character diagnostic bound is applied. Redacted output preserves status
and non-sensitive error text. Query values and the full action URL must not
appear in logs or returned public error messages.

## Provider-engine integration

### Project and usage probes

`open-sse/services/projectId.js` classifies the single-read body from both
`loadCodeAssist` and `onboardUser`. A successful ineligible-tier challenge stops
onboarding and reports the typed event through an optional callback. A 403 from
either endpoint is classified before the bounded redacted diagnostic is built.
The function retains its current return contract and project-ID cache behavior.

`open-sse/services/usage/google.js` similarly reads each response body once,
classifies only Antigravity responses, and reports through an optional callback.
It preserves the official Antigravity headers, proxy options, status-specific
messages, and current JSON failure behavior. `open-sse/services/usage.js`
threads only explicit callback and connection context fields. It must not use
`...options` after trusted fields because that would allow caller data to
replace credentials, provider, proxy, or connection identity.

The callback is the only crossing point from the provider engine into app
state. The engine never imports the app store. Callback failure is fail-open
for the provider request and is logged without the URL.

### Chat error parsing

`open-sse/executors/antigravity.js` may add strict typed validation metadata to
its current `parseError` result. It must not change `buildHeaders`, the official
2.5.5 fingerprint, platform selection, request body construction, image parts,
or MIME-key translation.

`open-sse/utils/error.js` preserves executor-specific typed metadata through
`parseUpstreamError`, alongside the current status, message, reset-time, and
OpenRouter annotations. `createErrorResult` does not serialize the raw URL or
the typed challenge. The app-side `onValidationRequired` callback records it
before the ordinary sanitized error response is returned.

### Post-refresh response replacement

The 401 and 403 refresh branch in `open-sse/handlers/chatCore.js` has one
generic correction. Once refreshed credentials produce an HTTP response, the
retry result replaces all original attempt state regardless of `response.ok`.
Replacement includes `providerResponse`, `providerUrl`, outbound
`providerHeaders`, `finalBody`, `providerResponseFormat`, and target-request
logging. Error parsing therefore sees the retry response and can recognize a
retry-time validation challenge.

If the retry throws a transport, abort, or timeout error, that retry failure is
returned through the existing transport mapping. The original 401 or 403 is not
resurrected. No extra retry is added. Current timeout propagation,
unsupported-parameter retry, stream handling, request formatting, and account
fallback remain unchanged.

## App-side ephemeral service

Add `src/lib/antigravityVerification.js` as a server-only module. It owns a
module-private `Map` and `EventEmitter`. The raw URL is never attached to
`globalThis`, Zustand, a database facade, a repository, usage state, or a broad
notification payload.

Each entry contains only these fields.

```js
{
  connectionId,
  challengeId,
  generation,
  url,
  observedAt,
  expiresAt
}
```

`challengeId` is an opaque `crypto.randomUUID()` value. `generation` comes from
a process-local monotonically increasing safe integer. The URL is stored only
in this server entry. Email, connection name, provider credentials, upstream
body, and diagnostic text are not stored.

The fixed policy is a ten-minute TTL, at most 256 live connection entries, and
a one-minute unreferenced cleanup sweep. Every public operation also performs
lazy expiry. When at capacity after expiry cleanup, the oldest observed entry
is removed before the new one is inserted. Process restart, development reload,
or module recreation begins empty. There is no disk persistence or recovery.

Recording a challenge allocates a new generation and challenge ID, then
replaces only that connection's entry. It emits a sanitized upsert event after
the synchronous Map update. Removal emits only the connection ID and removed
challenge ID.

Every upstream operation snapshots the current challenge ID before it begins.
A successful chat, project-ID probe, or Antigravity usage probe calls
`clearIfCurrent(connectionId, snapshottedChallengeId)`. No challenge at start
means no clear. If a parallel request records a newer challenge, the IDs differ
and the successful older operation cannot clear it. A failed probe never
clears. A repeated validation response records a new generation. Connection
deletion unconditionally removes that connection's entry after the database
deletion succeeds.

Success has a narrow definition. Chat success uses the existing completed
request success callback. Project setup success requires an extracted project
ID. Usage success requires the provider's successful parsed quota response, not
merely the absence of a classified challenge. An HTTP error, transport error,
malformed success payload, or generic message result does not clear state.

## Sensitive API

Use dedicated routes below the Antigravity provider namespace.

```text
GET    /api/providers/antigravity/verification/stream
GET    /api/providers/antigravity/verification/[connectionId]
DELETE /api/providers/antigravity/verification/[connectionId]
```

The stream sends an initial `snapshot`, then `upsert` and `remove` events. Its
JSON contains only `connectionId`, `challengeId`, and `expiresAt`. It never
contains a URL, email, account label, reason message, or upstream response. The
detail GET first confirms that the connection exists and belongs to
`antigravity`, then returns the current `{ challengeId, expiresAt, href }`.
Missing, expired, deleted, wrong-provider, and unknown entries all return the
same 404 shape.

DELETE accepts a JSON body containing `challengeId` and performs a
compare-and-clear dismissal. A stale ID returns 409 without revealing the
current ID. Deleting verification state does not delete or disable the provider
connection.

All successes and errors use `Cache-Control: private, no-store, max-age=0`,
`Pragma: no-cache`, `Referrer-Policy: no-referrer`, and
`X-Content-Type-Options: nosniff`. The SSE route additionally uses
`text/event-stream`, `no-transform`, `X-Accel-Buffering: no`, abort cleanup,
listener cleanup, and a 25-second comment heartbeat. No route emits permissive
CORS headers, and no URL appears in a redirect `Location` header. The browser
navigates directly only after authenticated detail retrieval and local
revalidation.

### Route authorization

Phase 2 adds a route-local helper for this exact policy. It reuses
`isLocalRequest`, `hasValidCliToken`, dashboard JWT verification, and current
settings. The general `/api/providers` guard is not the final trust boundary.

| Request context | `requireLogin=true` | `requireLogin=false` |
| --- | --- | --- |
| Proven loopback browser with valid JWT | allow | allow |
| Proven loopback browser without JWT | deny 401 | allow |
| Remote or tunnel caller with valid JWT | allow | allow |
| Remote or tunnel caller with valid CLI token | allow | allow |
| Remote or tunnel caller without JWT or CLI token | deny 401 | deny 401 |
| Forged Host, Origin, forwarding, or XFF without token | deny 401 | deny 401 |

`isLocalRequest` remains authoritative for proven loopback. A
`x-9r-via-proxy` request is remote even when its socket hop is loopback. A
Host header alone never proves local access. The same matrix applies to stream,
detail, and dismissal methods. An unauthenticated remote no-login dashboard may
continue using ordinary non-sensitive dashboard features, but it cannot see or
open a verification link.

## Dashboard behavior

Only the Antigravity provider page subscribes. Add a page-scoped hook at
`src/app/(dashboard)/dashboard/providers/[id]/useAntigravityVerification.js`.
It opens one dedicated EventSource while the Antigravity page is mounted. It
uses sanitized events to fetch the exact detail route, repeats the full URL
validation, and holds the resulting href only in component state. It drops the
href on expiry, removal, route failure, provider navigation, or unmount. It does
not use Zustand, `DashboardLayout`, `UsageStats`, or `/api/usage/stream`.

`ConnectionRow` receives a verification prop only for the matching connection.
The row renders a real anchor beside the existing controls with
`target="_blank"` and `rel="noopener noreferrer"`. The visible text is a
translated action label, never the raw URL. Its accessible name combines the
translated action with the existing connection name. The anchor remains
keyboard focusable and uses the existing focus style. The action container
uses a wrapping layout rather than adding another fixed grid column.

Opening the anchor does not clear the challenge. A separate translated
`Check verification` button invokes the current forced connection usage refresh
through `/api/usage/[connectionId]?force=true`. That app route supplies the
typed callback and snapshot ID to the Antigravity usage service. A verified
successful usage response compare-clears the same challenge. A repeated
validation response replaces it with a newer challenge, and any other failure
leaves it visible. Existing Antigravity hot reload stays present and unchanged.

If sensitive-route authorization fails, the page renders no href and gives an
accessible translated explanation that verification requires a signed-in or
local dashboard. It does not fall back to usage stats, console logs, a global
banner, or an imperative `window.open` call.

The exact new English literal keys are these strings.

```text
Verify Antigravity account
Check verification
Antigravity account verification required
Sign in or use the local dashboard to verify Antigravity
Verification link expired
Unable to load verification link
```

Each key is added to all 34 files under `public/i18n/literals`. English remains
the runtime source text. Brand spelling is always `Antigravity`. UI tests check
the literal inventory and the accessible name in a non-English locale.

## PR #3630 ownership reconciliation

PR #3630 is rejected and must not be used as a guard implementation base. Its
future guard-inventory task exclusively owns `src/dashboardGuard.js` and its
generated capability matrix. This adaptation does not edit that file.

Phase 2 owns the new routes, their route-local authorization helper, and their
end-to-end auth tests. The route inventory test records all three routes as
`sensitive-verification`. A later PR #3630 guard-inventory task may centralize
that policy only if it preserves the exact matrix above and changes the helper,
guard, and tests in one reviewed commit. Until then, middleware may provide an
outer check, but route-local authorization is mandatory. No implementation leaf
may own `dashboardGuard.js` for both efforts, and neither effort may silently
stack on the submitted PR #3630 hunk.

## Phased implementation ownership

The feature is delivered as three sequential, independently reviewed phases.

### Phase 1, classifier and retry preservation

This phase owns the new pure classifier and the smallest changes in current
`antigravity.js`, `projectId.js`, `usage/google.js`, `usage.js`, `error.js`, and
`chatCore.js`. It adds no app state or UI. Strict RED tests cover every accepted
and rejected structured shape, redaction, single-read bodies, and complete retry
replacement. The phase cannot alter headers, fingerprints, images, timeouts,
fallback, or public response schema.

### Phase 2, bounded state and sensitive delivery

This phase owns the app-side service, explicit app callbacks, connection
deletion cleanup, the three routes, route-local auth helper, and focused state,
route, stats-exclusion, and auth tests. It does not own `dashboardGuard.js`,
`usageRepo`, `usageDb`, general usage SSE, request-detail schema, or a database
migration.

### Phase 3, provider-page action and localization

This phase owns the page-scoped hook, current Antigravity provider page,
`ConnectionRow`, and all 34 literal files. It preserves all current row props,
hot reload, atomic settings, deadline settings, model discovery, proxy controls,
and queues. It does not own `DashboardLayout`, `UsageStats`, a global store, or
any other provider page.

Each phase is one logical commit only after its focused RED and GREEN evidence
passes. The next phase begins only after a fresh review of the prior phase.

## Verification plan

### Classifier and redaction

- Accept the exact loadCodeAssist ineligible tier with no current tier.
- Accept exact 403 ErrorInfo for each of the three Cloud Code domains.
- Accept the first Help link and the official `metadata.validation_link`
  fallback.
- Reject wrong HTTP status, body code, type, domain, reason, current tier,
  missing URL, root URL, appeal field, raw regex match, later Help link, and
  loosely named fields.
- Reject HTTP, alternate host, subdomain, trailing-dot host, credentials,
  non-default port, controls, leading or trailing whitespace, malformed URL,
  and more than 8,192 UTF-8 bytes.
- Prove raw and malformed diagnostics contain neither the full URL nor any
  opaque query value while retaining non-sensitive text.

### Retry and provider behavior

- RED proves a post-refresh 403 replaces the original response and is
  classified from the retry body.
- Verify replacement of response, URL, headers, transformed body, response
  format, and target log on retry success and retry HTTP error.
- Verify retry transport, timeout, and abort failures return their own mapped
  result.
- Run current project-ID, Antigravity usage-header, quota, token-refresh,
  image-editing, IDE-version-sync, chat transport, unsupported-field, and
  account-fallback tests.
- Assert no diff to official fingerprint constants, Antigravity build headers,
  image-part logic, or MIME-key translation.

### State, privacy, and authorization

- Use a fake clock to prove ten-minute expiry, lazy and sweep cleanup, a
  256-entry cap, oldest eviction, restart-empty initialization, and timer
  unref.
- Prove per-connection isolation, increasing generations, stale dismissal
  rejection, deletion clear, and success compare-clear that cannot erase a
  newer challenge.
- Prove the raw URL is absent from active requests, usage stats, usage stream,
  request details, request logs, error JSON, sanitized SSE, and process globals.
- Exercise every row of the authorization table against both route handlers and
  the current dashboard proxy, including trusted peer headers, forged Host,
  Origin, XFF, tunnel stamping, valid and invalid JWT, and valid and invalid CLI
  tokens.
- Assert no-store headers on every status, no wildcard CORS, stream abort
  cleanup, no listener growth, and no URL in `Location`, SSE, or log output.

### UI, localization, and end-to-end behavior

- Render the current row with hot reload and verification together. Prove each
  control remains usable.
- Assert exact href, `_blank`, `noopener noreferrer`, translated accessible
  name, keyboard focus, matching connection only, and no raw URL text.
- Prove expired, dismissed, unauthorized, invalid, and failed-detail states
  render no anchor.
- Prove one provider-page EventSource, cleanup on unmount or navigation, no
  `/api/usage/stream` subscriber, explicit check behavior, and race-safe refresh.
- Check all 34 locale catalogs for all six literals and render one non-English
  locale.
- Run syntax checks, ESLint with no new warning, `git diff --check`, the
  production build, and the repository no-regression verifier.
- Run a credentialed isolated Antigravity probe. The receipt records only the
  classification source, connection ID prefix, challenge ID, expiry, UI action,
  retry outcome, and clear outcome. It redacts the URL and all query values.

## Explicit exclusions

- No merge, cherry-pick, or patch application from upstream PR #3635.
- No URL in `globalThis`, usage repositories, SQLite, usage payloads, general
  usage SSE, request-detail records, public errors, or logs.
- No `DashboardLayout` subscription, global banner, Zustand verification
  store, duplicate stats subscriber, or global dismissal control.
- No change to official Antigravity fingerprint headers, platform enums,
  image handling, MIME translation, timeout behavior, or account fallback.
- No restoration of `src/sse/services/antigravityQuota.js` or its deleted tests.
- No change to `src/dashboardGuard.js` in this adaptation.
- No unrelated package, lockfile, registry, generated snapshot, schema,
  migration, quota schema, or provider UI change.
- No automatic browser launch, automatic retry loop, automatic challenge
  dismissal, or URL redirect from the server.

## Completion criteria

The adaptation is complete only when all three phases and their fresh reviews
pass, the production build and no-regression verifier pass, the sensitive URL
is absent from every excluded channel, and an isolated credentialed probe
demonstrates capture, connection-scoped display, explicit user navigation,
explicit recheck, and race-safe clear. Without the credentialed probe, the code
may be implementation-complete but the feature remains runtime-unverified.
