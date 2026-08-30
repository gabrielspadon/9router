# Cursor HTTP/2 Proxy Adaptation

**Date:** 2026-08-30
**Status:** Approved for specification review
**Source:** Adapt upstream PR #3276. Do not apply its raw patch.

## Decision

Add a small Node-only HTTP/2 connection adapter for Cursor's `GetUsableModels`
and `AgentService/Run` endpoints. It will use the already-selected connection
proxy, otherwise the existing environment proxy policy, and will preserve the
executor's response-header deadline and caller-abort identity.

The adapter supports direct connections plus HTTP, HTTPS, and SOCKS proxy URLs.
It never interprets a Vercel or Cloudflare request relay as a TCP tunnel. A
selected relay has no demonstrated HTTP/2 CONNECT contract, so it produces an
explicit unsupported-route failure rather than a silent direct Cursor request.

## Why this approach

1. Applying the upstream patch is rejected. Its `https:` proxy path opens a
   plaintext TCP connection to port 443 before sending CONNECT, so proxy
   credentials and target authority can be exposed. Its new async connection
   path also bypasses the canonical abort and header-deadline ownership.
2. Refactoring every proxy-aware transport is rejected. Undici fetch, manual
   MITM bypass, relays, and HTTP/2 have different lifecycles. A broad rewrite
   would enlarge an already security-sensitive surface.
3. A dedicated HTTP/2 adapter is selected. Node documents that
   `http2.connect()` accepts `createConnection` returning a Duplex stream, so a
   fully established TLS-over-tunnel socket can remain under the normal HTTP/2
   session API. [Node HTTP/2 documentation](https://nodejs.org/download/release/v25.9.0/docs/api/http2.html)

## Scope

### Goals

- Make both Cursor AgentService paths use the same effective egress identity.
- Preserve the current direct-route response-header deadline, caller abort
  reason, cleanup, and post-header stream lifetime.
- Keep live-model cache entries distinct for direct and differently proxied
  catalogs without logging proxy credentials.
- Correct the `RequestedModel` protobuf shape and normalize only the known
  invalid Fable `-fast` aliases.
- Test all transport behavior without a live proxy or Cursor credential.

### Non-goals

- Changing generic fetch behavior, proxy-pool schema, routing, fallback, or
  account status policy outside the narrow proxy-selection provenance needed by
  the new structured route resolver.
- Implementing a relay TCP tunnel, HTTP/2-over-relay protocol, proxy rotation,
  or a new proxy package.
- Sending AgentService thinking, KV blob, debug-field, or protocol-version
  updates from the upstream pull request.
- Claiming a live Cursor model catalog or chat result without separately
  recorded credentialed evidence.

## Persisted strict pool selection

`proxyPoolId` and `strictProxy` are one persisted selection. They are not two
independent client-supplied settings. A pool assignment records both values in
the same `providerSpecificData` write, for example
`{ proxyPoolId: "pool-a", strictProxy: true }`. The server obtains the boolean
from the selected active pool. A client cannot choose a strict value that
disagrees with that pool. Clearing the pool assignment deletes both fields in
the same write, so a later legacy direct configuration cannot inherit a stale
strict requirement.

`POST /api/providers` and `PUT /api/providers/[id]` must implement this
lifecycle. Their pool normalizers return the validated active pool's ID and its
strict boolean, and the create/update paths persist or clear the pair together.
The update merge keeps the pair through unrelated provider-specific edits.
Token refresh also keeps it because its merge starts with the existing
`providerSpecificData`; a refresh may not erase selection provenance.

No-auth provider strategies use the same pair in
`settings.providerStrategies[providerId]`. The settings PATCH path validates
and resolves a submitted `proxyPoolId`, then atomically stores that pool's
current `strictProxy` with it. A clearing patch removes both. It rejects a
caller-supplied standalone or mismatched `strictProxy` rather than treating the
boolean as an arbitrary strategy knob. For a rotating strategy, the selected
pool object supplies both values to the virtual connection before a second
lookup. Thus a pool disappearing between rotation and resolution retains the
selected strict provenance.

Pre-egress migration applies to every existing persisted selection that has a
`proxyPoolId` but no boolean `strictProxy`, including a normal provider
connection's `providerSpecificData` and a no-auth provider strategy. The shared
connection-proxy resolver becomes the mandatory pre-egress migration gate for
all persisted normal-connection callers, not only `getProviderCredentials()`.
It receives a persistence owner, or an injected `persistPoolSnapshot` callback,
with the selected data. A normal connection caller supplies an atomic update for
that exact connection; a no-auth caller supplies the atomic strategy update. A
pairless input without such a persistence owner is unsafe and returns
`required-unavailable`, never the old non-strict behavior.

For a normal connection, the gate reads its selected pool, requires an active
well-formed pool, atomically writes the pair to that exact connection's
`providerSpecificData`, and only then returns a usable proxy configuration. All
callers that begin from a persisted connection, including credential selection,
model discovery, quota/usage, hot-reload, and provider test paths, use that
gate instead of calling the raw resolver with only `providerSpecificData`. For
a no-auth strategy, do the equivalent atomic strategy update before constructing
the virtual connection.

If a pairless selected pool is missing, inactive, malformed, its lookup throws,
or the migration write fails, do not infer a non-strict selection. Return
`required-unavailable` and make zero environment or direct egress attempts
until the user selects or clears a pool. On a successful migration, a later
pool disappearance, deactivation, malformed record, or resolver exception uses
the persisted strict snapshot and likewise fails closed. This conservative
legacy behavior avoids an unknowable historical strict selection silently
escaping direct.

## Effective egress route

`resolveConnectionProxyConfig()` will preserve the stored pair before it reads
a pool. In particular, it retains the selected pool ID and stored `strictProxy`
if the pool is missing, inactive, malformed, or its lookup throws. Its result
distinguishes an intentional `__none__` from `missing-selected-pool`,
`inactive-selected-pool`, and `selection-resolution-error`. It must not convert
those error states to `strictProxy: false`.

The migration gate returns pairless legacy selection as
`required-unavailable` when it cannot durably record the pair. It must not
treat an absent `strictProxy` as false or consult environment settings for it.
This makes the migration barrier explicit rather than depending on the current
pool row to survive until a transport is selected.

The credential handoff carries `connectionProxyPoolId` and `strictProxy`; the
stored boolean is authoritative only when the selected pool cannot be read. An
active pool still supplies its current strict setting. This lets an intentionally
strict connection fail closed during database or pool-state failure instead of
escaping through environment or direct egress.

One pure resolver in `open-sse/utils/proxyFetch.js` will consume that provenance
and expose a structured route, not only a URL. Its result is one of `direct`,
`proxy`, `relay`, or `required-unavailable`.

| Input precedence | Route | HTTP/2 behavior |
| --- | --- | --- |
| Selected `vercelRelayUrl` | `relay` | Reject before a socket is opened. The existing relay sends one HTTP request with relay headers and cannot be assumed to carry arbitrary TLS/H2 bytes. |
| Selected connection/pool proxy | `proxy` | Honor `connectionNoProxy`, then use the normalized connection URL. |
| Pairless persisted selected pool that cannot be migrated | `required-unavailable` | Reject before environment resolution or socket construction. |
| Missing, inactive, malformed, or failed selected pool | `required-unavailable` when strict | Reject before socket construction. Non-strict selection follows existing fallback policy. |
| Environment proxy | `proxy` | Reuse `HTTPS_PROXY` then `ALL_PROXY`, including existing loopback and `NO_PROXY` rules. |
| No selected proxy | `direct` | Use normal `http2.connect()`. |

`strictProxy` changes failure behavior, not route order. A selected strict
connection proxy with no usable URL, an invalid proxy scheme, a failed tunnel,
or a selected relay results in a typed required-proxy failure. It never falls
back to an environment proxy or direct egress. A non-strict HTTP/SOCKS proxy
failure may use the existing direct fallback only when no relay was selected.
An explicit `connectionNoProxy` match is an intentional direct route, not a
proxy failure.

The resolver's route descriptor carries selection provenance plus a non-secret
cache identity. The cache key may hash the full normalized proxy URL inside the
SHA-256 input to distinguish credentials that select different egress, but no
raw URL or userinfo may reach logs, returned errors, or a map key exposed to
callers.

## HTTP/2 tunnel adapter

`open-sse/utils/http2Connect.js` will own only socket construction and session
cleanup.

```js
connectHttp2(url, { route, signal })
  -> Promise<{
       session: ClientHttp2Session,
       effectiveRoute: Route,
       close: () => void,
     }>
```

The caller owns deadline classification. The adapter accepts its composed
signal, rejects pre-abort with `signal.reason`, and during any pending stage
destroys the pending socket or session with that same reason. It must remove
every listener after settlement. `effectiveRoute` is the route that established
the returned session, not the initially requested route.

| Route | Socket sequence |
| --- | --- |
| direct | `http2.connect(origin)` |
| `http:` proxy | TCP to proxy, HTTP/1.1 CONNECT, TLS to Cursor with `ALPNProtocols: ["h2"]`, then `http2.connect(origin, { createConnection })` |
| `https:` proxy | TLS to the proxy first with `servername` set to the proxy hostname and default certificate verification, HTTP/1.1 CONNECT inside that TLS channel, TLS to Cursor with ALPN h2, then the HTTP/2 session |
| SOCKS 4, 4a, 5, 5h | Obtain a tunnel socket through installed `socks-proxy-agent`, then TLS to Cursor with ALPN h2 and `createConnection` |

Only `http:`, `https:`, `socks:`, `socks4:`, `socks4a:`, `socks5:`, and
`socks5h:` are accepted. The HTTP CONNECT request uses the target hostname and
port, validates a 200 response, preserves buffered bytes, and adds Basic proxy
authorization only from URL userinfo. HTTPS proxy TLS must retain certificate
validation. `rejectUnauthorized: false`, raw proxy URLs, and raw credentials
are prohibited.

Once a `TLSSocket` is handed to `http2.connect`, only the HTTP/2 session owns
normal traffic. The returned lease owns the HTTP/2 session and tunnel socket.
`lease.close()` is idempotent and is the only close entry point used by the
catalog path, so a caller can prove one cleanup even when the session emits a
later error. Session close or error destroys the tunnel socket as a best-effort
backstop.

For a non-strict proxy route, proxy failure is resolved inside the adapter by a
new direct connection and returns `effectiveRoute: direct`. A strict route, a
relay route, and every `required-unavailable` route fail before that fallback.
No direct dial, SOCKS dial, HTTP CONNECT, or `http2.connect` is allowed for a
strict unavailable route.

If a non-strict proxied attempt allocates a socket or session before failing,
the adapter closes that failed proxy resource exactly once before it creates the
direct fallback lease. The caller sees only the lease for the established
effective route and never owns both attempts.

## Cursor integration

### AgentService Run

`CursorExecutor.openAgentHttp2Stream()` becomes asynchronous because the
tunnel must be established before an HTTP/2 session exists. It creates its
existing `createExecutorResponseHeaderTimeout` before awaiting the adapter and
passes the deadline signal into `connectHttp2`.

- A deadline during TCP, proxy TLS, CONNECT, target TLS, H2 connect, or before
  response headers remains the existing `ConnectTimeoutError`.
- A caller abort remains the exact caller-provided reason, both before and
  after response headers.
- On response headers, clear only the header deadline. Keep the current
  full-stream caller listener and cleanup behavior unchanged.
- Close the request, HTTP/2 session, and tunnel exactly once on all outcomes.

The executor obtains the route from the structured resolver once per request.
It must reject a relay route before network access and use the same selected
route for the AgentService request. Proxy host logging is optional and must
mask credentials.

### Live catalog

`resolveCursorModels()` receives `proxyOptions` from both existing model routes
after they call `resolveConnectionProxyConfig`. The unary catalog path resolves
the same route once, then passes it to the HTTP/2 adapter.

The five-minute cache becomes:

```text
SHA-256("cursor:" + machineId + ":" + accessToken + ":" + routeCacheIdentity)
```

`routeCacheIdentity` comes only from `effectiveRoute`. It distinguishes direct
and each normalized proxy identity, and it is hashed before storage and never
logged. This prevents a direct regional catalog from satisfying a proxied
international-catalog lookup, or vice versa.

For a direct or strict-proxy route, the effective route is fixed and an
eligible cache entry may be consulted before transport. Relay and
required-unavailable routes never read a catalog cache and fail before egress.
For a non-strict proxy route, the catalog must establish a `SessionLease`
first. It then consults or warms only the cache key for the returned
`effectiveRoute`. On a cache hit it calls `lease.close()` before returning the
entry. This applies to both a successful proxy lease and a proxy-to-direct
fallback lease. Therefore a proxied cache hit closes its unused proxy session
exactly once, a fallback-to-direct cache hit closes its unused direct lease
exactly once, and any failed proxy attempt was already closed once inside the
adapter. Thus a failed proxy followed by direct fallback never reads or warms
the selected proxy's cache key. A catalog error still returns `null` so its
established static catalog fallback remains intact, but strict routing never
creates a direct attempt first.

Catalog transport gets two injected seams:

```js
connectHttp2(url, { route, signal }) -> Promise<SessionLease>
http2Post(lease.session, headers, body, { signal })
  -> Promise<{ status, body }>
```

Production defaults to the adapter-backed implementation. `http2Post` borrows
the session and never closes it. On a cache miss, the catalog owns the lease
and closes it in a single `finally` after `http2Post`. Tests inject both seams
instead of replacing global fetch or opening a real HTTP/2 socket. No
`http2Post` call is allowed after a cache hit.

### Agent protobuf and model mapping

`RequestedModel` encodes only `model_id` in field 1. The current boolean in
field 7 is removed because it is not a max-mode flag and belongs to unrelated
credentials in the adjacent wire schema.

`resolveCursorAgentModel(model)` removes a final `-fast` only when the model
is in the `claude-fable-` family. It maps
`claude-fable-5-thinking-max-fast` to
`claude-fable-5-thinking-max`; all Opus, GPT, Grok, non-Fable, and non-final
`-fast` strings pass through unchanged. Mapping happens immediately before
building the Run frame and does not alter the client-facing requested model.

## Explicitly deferred protocol work

The upstream pull request interprets an AgentService update field as thinking
and forwards it as `reasoning_content`. This has no committed Cursor proto
contract or captured frame in this repository, while the current executor
intentionally suppresses unsigned internal reasoning for strict Anthropic
clients. This adaptation does not change that behavior.

KV blob handshakes, AgentService debug telemetry, and any future thinking
translation require a captured protocol fixture, a separately approved design,
and format-specific client validation. They are not side effects of proxy
tunnelling.

## Test matrix

1. Add `tests/unit/http2-connect.test.js` with injected/fake net, TLS, SOCKS,
   and HTTP/2 primitives. Cover direct, HTTP CONNECT authentication and 200
   validation, HTTPS-proxy TLS/SNI/verification, SOCKS selection, unsupported
   schemes, partial CONNECT buffering, non-strict direct fallback with returned
   `effectiveRoute`, strict fail-closed behavior, caller abort at each pending
   stage, and exactly-once resource cleanup. Prove a failed proxy resource is
   closed once before a returned direct fallback lease. The strict unavailable
   cases must prove zero calls to net, TLS, SOCKS, and HTTP/2 connection
   primitives.
2. Extend `tests/unit/cursor-connect-timeout.test.js` for asynchronous
   AgentService setup. Prove the existing header deadline and the exact caller
   abort reason survive direct and proxied setup, both before and after
   response headers, with no timers or listeners left behind.
3. Replace the catalog test's global-fetch assumption in
   `tests/unit/cursor-models.test.js` with the injected session and post seams.
   Prove identical route hits cache, direct and two proxy identities do not
   share cache, and a failed non-strict proxy fallback neither reads nor warms
   its selected proxy cache key. Seed a direct-key cache entry, have the
   injected connector report an attempted proxy then return a direct fallback
   lease, and assert `http2Post` is not called, the returned lease's `close()`
   is called exactly once, and the adapter's failed proxy resource is closed
   exactly once. Add the corresponding successful-proxy cache-hit assertion.
   Strict unavailable and relay routes must make zero direct or environment
   transport calls, while catalog fallback remains `null` on failure.
4. Extend `tests/unit/cursor-agent-proto.test.js` to decode the nested
   `RequestedModel`, assert field 1 only, and cover Fable-fast normalization
   plus non-Fable preservation.
5. Extend `tests/unit/strict-proxy-propagation.test.js`, provider route tests,
   and `tests/unit/settings-connect-timeout.test.js` (or focused successor
   files). Prove create records `{ proxyPoolId, strictProxy }`, update replaces
   both from the selected active pool, explicit clearing deletes both, and an
   unrelated credentials refresh preserves both. Prove a no-auth fixed-pool
   strategy records and clears the same pair, a rotating selection carries the
   selected pool strict snapshot, and a legacy strategy is atomically migrated
   before use only when its pool is active. Seed a real stored normal connection
   and a real stored no-auth strategy with only `{ proxyPoolId: "pool-strict" }`.
   With an active strict pool, assert the durable pair is written before the
   shared resolver returns a usable config, including through a non-auth normal
   connection caller; then remove that pool and assert the next resolution is
   `required-unavailable` with zero egress. Separately seed pairless normal and
   no-auth records whose selected pool is missing, inactive, malformed, or
   throws on lookup, plus a migration-write failure or absent persistence owner.
   Each must be
   `required-unavailable` and prove zero calls to environment resolution,
   `net.connect`, `tls.connect`, SOCKS, HTTP CONNECT, direct `http2.connect`,
   and catalog post seams. Repeat the disappearance, deactivation, and resolver
   throw assertions for records already persisted with
   `{ proxyPoolId: "pool-strict", strictProxy: true }`. Also assert a cache hit
   closes a returned proxy lease exactly once and a fallback-to-direct cache hit
   closes the returned direct lease exactly once.
6. Add focused route tests, or extract a small pure proxy-options builder, to
   prove both `/api/v1/models` and `/api/providers/[id]/models` pass the
   resolved connection proxy and persisted `strictProxy` to Cursor catalog
   discovery. Cover missing/inactive selected pools and resolver exceptions
   that retain strict provenance and produce no egress.
7. Run those focused suites, the Cursor adjacency suites, lint for changed
   files, the repository regression-baseline verifier, and the normal build.
   Live Cursor/proxy tests remain an explicitly unrun external gate unless
   authenticated test credentials and a disposable proxy are supplied.

## Expected implementation boundary

```text
open-sse/utils/http2Connect.js                         new dedicated adapter
open-sse/utils/proxyFetch.js                           structured route resolver
open-sse/executors/cursor.js                           AgentService route, deadline, model field
open-sse/services/cursorModels.js                      catalog route, cache, injected seam
src/lib/network/connectionProxy.js                     migration gate and strict provenance
src/app/api/v1/models/route.js                         resolved Cursor catalog options
src/app/api/providers/[id]/models/route.js             resolved Cursor catalog options
src/app/api/providers/route.js                          pool strict snapshot on create
src/app/api/providers/[id]/route.js                     pool strict snapshot lifecycle
src/app/api/settings/route.js                           no-auth strategy snapshot validation
src/lib/db/repos/settingsRepo.js                        atomic strategy snapshot lifecycle
src/sse/services/auth.js                                normal/no-auth gate ownership
open-sse/services/tokenRefresh.js                       preserve selection pair on refresh
all persisted connection-proxy callers                  use migration gate, not raw data
tests/unit/http2-connect.test.js                       new transport tests
tests/unit/cursor-connect-timeout.test.js              lifecycle regression tests
tests/unit/cursor-models.test.js                       cache and seam tests
tests/unit/cursor-agent-proto.test.js                  protobuf and mapping tests
tests/unit/strict-proxy-propagation.test.js             persisted fail-closed tests
tests/unit/settings-connect-timeout.test.js             strategy lifecycle and migration tests
```

No generated registry, dependency manifest, dashboard, production service, or
tracking file changes are part of this adaptation.
