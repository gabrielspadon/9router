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
  account status policy outside the new structured route resolver.
- Implementing a relay TCP tunnel, HTTP/2-over-relay protocol, proxy rotation,
  or a new proxy package.
- Sending AgentService thinking, KV blob, debug-field, or protocol-version
  updates from the upstream pull request.
- Claiming a live Cursor model catalog or chat result without separately
  recorded credentialed evidence.

## Effective egress route

One pure resolver in `open-sse/utils/proxyFetch.js` will expose a structured
route, not only a URL. Its result is one of `direct`, `proxy`, `relay`, or
`required-unavailable`.

| Input precedence | Route | HTTP/2 behavior |
| --- | --- | --- |
| Selected `vercelRelayUrl` | `relay` | Reject before a socket is opened. The existing relay sends one HTTP request with relay headers and cannot be assumed to carry arbitrary TLS/H2 bytes. |
| Selected connection/pool proxy | `proxy` | Honor `connectionNoProxy`, then use the normalized connection URL. |
| Environment proxy | `proxy` | Reuse `HTTPS_PROXY` then `ALL_PROXY`, including existing loopback and `NO_PROXY` rules. |
| No selected proxy | `direct` | Use normal `http2.connect()`. |

`strictProxy` changes failure behavior, not route order. A selected strict
connection proxy with no usable URL, an invalid proxy scheme, a failed tunnel,
or a selected relay results in a typed required-proxy failure. It never falls
back to an environment proxy or direct egress. A non-strict HTTP/SOCKS proxy
failure may use the existing direct fallback only when no relay was selected.
An explicit `connectionNoProxy` match is an intentional direct route, not a
proxy failure.

The route resolver will return a non-secret cache identity. The cache key may
hash the full normalized proxy URL inside the SHA-256 input to distinguish
credentials that select different egress, but no raw URL or userinfo may reach
logs, returned errors, or a map key exposed to callers.

## HTTP/2 tunnel adapter

`open-sse/utils/http2Connect.js` will own only socket construction and session
cleanup.

```js
connectHttp2(url, { route, signal }) -> Promise<ClientHttp2Session>
```

The caller owns deadline classification. The adapter accepts its composed
signal, rejects pre-abort with `signal.reason`, and during any pending stage
destroys the pending socket or session with that same reason. It must remove
every listener after settlement.

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
normal traffic. Session close or error destroys the tunnel socket as a
best-effort backstop.

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

`resolveCursorModels()` receives `proxyOptions` from both existing model
routes after they call `resolveConnectionProxyConfig`. The unary catalog path
resolves the same route once, then passes it to the HTTP/2 adapter.

The five-minute cache becomes:

```text
SHA-256("cursor:" + machineId + ":" + accessToken + ":" + routeCacheIdentity)
```

`routeCacheIdentity` distinguishes direct, each normalized proxy identity, and
relay. It is hashed before storage and is never logged. This prevents a direct
regional catalog from satisfying a proxied international-catalog lookup, or
vice versa. A catalog error still returns `null` so its established static
catalog fallback remains intact, but strict routing never creates a direct
attempt first.

Catalog transport gets one injected seam:

```js
http2Post(url, headers, body, { signal, route }) -> Promise<{ status, body }>
```

Production defaults to the adapter-backed implementation. Tests use this seam
instead of replacing global fetch or opening a real HTTP/2 socket.

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
   schemes, partial CONNECT buffering, non-strict direct fallback, strict
   fail-closed behavior, caller abort at each pending stage, and exactly-once
   resource cleanup.
2. Extend `tests/unit/cursor-connect-timeout.test.js` for asynchronous
   AgentService setup. Prove the existing header deadline and the exact caller
   abort reason survive direct and proxied setup, both before and after
   response headers, with no timers or listeners left behind.
3. Replace the catalog test's global-fetch assumption in
   `tests/unit/cursor-models.test.js` with `http2Post`. Prove identical route
   hits cache, direct and two proxy identities do not share cache, strict
   unavailable/relay routes cause no direct transport, and catalog fallback is
   still `null` on failure.
4. Extend `tests/unit/cursor-agent-proto.test.js` to decode the nested
   `RequestedModel`, assert field 1 only, and cover Fable-fast normalization
   plus non-Fable preservation.
5. Add focused route tests, or extract a small pure proxy-options builder, to
   prove both `/api/v1/models` and `/api/providers/[id]/models` pass the
   resolved connection proxy and `strictProxy` to Cursor catalog discovery.
6. Run those focused suites, the Cursor adjacency suites, lint for changed
   files, the repository regression-baseline verifier, and the normal build.
   Live Cursor/proxy tests remain an explicitly unrun external gate unless
   authenticated test credentials and a disposable proxy are supplied.

## Expected implementation boundary

```text
open-sse/utils/http2Connect.js                         new dedicated adapter
open-sse/utils/proxyFetch.js                           structured route resolver
open-sse/executors/cursor.js                           AgentService route, deadline, model field
open-sse/services/cursorModels.js                      catalog route, cache, injected seam
src/app/api/v1/models/route.js                         resolved Cursor catalog options
src/app/api/providers/[id]/models/route.js             resolved Cursor catalog options
tests/unit/http2-connect.test.js                       new transport tests
tests/unit/cursor-connect-timeout.test.js              lifecycle regression tests
tests/unit/cursor-models.test.js                       cache and seam tests
tests/unit/cursor-agent-proto.test.js                  protobuf and mapping tests
```

No generated registry, dependency manifest, dashboard, production service, or
tracking file changes are part of this adaptation.
