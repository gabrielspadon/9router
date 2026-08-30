# Cursor HTTP/2 Proxy Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Route Cursor AgentService Run and GetUsableModels through the selected effective egress without weakening strict proxy policy, response-header timing, caller abort, cache isolation, or Cursor protobuf behavior.

**Architecture:** Keep durable pool selection, effective-route resolution, HTTP/2 socket construction, Cursor streaming, and Cursor catalog caching isolated. The connection resolver returns a discriminated selected, explicit-direct, unselected, or required-unavailable result. The Node-only adapter owns one session lease and exposes the effective route that established it.

**Tech Stack:** Node ESM, Node http2/net/tls, installed socks-proxy-agent, SQLite adapter repositories, Next route handlers, Vitest 4.

## Global Constraints

- Adapt upstream PR 3276 behavior only. Do not apply its patch or change generic fetch, proxy rotation, dashboard, registries, dependency manifests, production services, or tracking.
- Accept only http, https, socks, socks4, socks4a, socks5, and socks5h tunnel URLs.
- Relay is not a TCP tunnel. Relay and required-unavailable make zero calls to environment proxy resolution, net, TLS, SOCKS, HTTP CONNECT, http2.connect, catalog cache, or catalog post.
- Strict selected routes never fall back to environment or direct egress. A selected route produces direct only for a target match in its connectionNoProxy list. An explicit legacy connectionProxyEnabled false selection is a connection-local intentional-direct decision that also bypasses environment lookup. A non-strict established proxy failure closes failed resources exactly once before direct fallback.
- Preserve existing header deadlines as ConnectTimeoutError. Preserve exact caller abort reasons before and after headers. Header deadline ends at headers, caller-abort lifetime remains until stream cleanup.
- SessionLease owns exactly one returned H2 session and tunnel. close is idempotent. Catalog http2Post borrows session and never closes it.
- Cache identity derives only from effective route. Hash normalized proxy URL internally and never log, return, or expose userinfo or a raw URL as a cache key.
- Persist proxyPoolId and strictProxy together. A pool mutation atomically fans out new strict snapshots to matching normal connections and no-auth strategies.
- RequestedModel contains only model_id in field 1. Strip final -fast only from claude-fable-* models. Do not add Agent reasoning, KV blob, debug, or protocol-version forwarding.
- All tests use fake primitives and injected seams. Credentialed Cursor and disposable-proxy verification remain unrun external gates.

## Test Environment Preflight

The current worktree cannot collect Vitest tests because root node_modules lacks vite and tests/node_modules lacks vitest. This is a blocked baseline, not a passing check. Static explicit test counts are cursor catalog 3, Cursor protobuf 25, Cursor timeout 11, strict proxy 6, and settings 16. Runtime it.each expansion must be recorded during execution.

- [ ] Install ignored local dependencies before the first RED run.

~~~bash
cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276
npm install --no-package-lock --ignore-scripts
cd tests
npm install --no-package-lock --ignore-scripts
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 status --short
~~~

Expected: no tracked dependency or lockfile changes.

## File Structure

| Path | Responsibility |
| --- | --- |
| open-sse/utils/proxyFetch.js | Structured effective-route resolver while preserving generic fetch behavior. |
| open-sse/utils/http2Connect.js | New Node-only tunnel and H2 session adapter with fake primitive injection. |
| open-sse/executors/cursor.js | AgentService routing, timing, abort, protobuf mapping, and thinking exclusion. |
| open-sse/services/cursorModels.js | Route-aware catalog cache, session lease ownership, and injected seams. |
| src/lib/network/connectionProxy.js | Durable strict-pair migration gate and safe options conversion. |
| src/lib/db/repos/{connectionsRepo,settingsRepo,proxyPoolsRepo}.js | Conditional snapshot persistence and atomic strict fan-out. |
| provider, settings, pool API routes | Write-boundary validation for strict selection pairs. |
| auth, token refresh, quota, usage, hot reload, provider test routes | Persistence owners and typed no-egress boundaries. |
| model routes | Cursor catalog proxy handoff and typed unavailable response. |
| tests/unit/http2-connect.test.js | New route and tunnel lifecycle coverage. |
| tests/unit/proxy-pool-strict-snapshot.test.js | New real SQLite fan-out/rollback coverage. |
| tests/unit/required-unavailable-callers.test.js | New per-caller zero-egress coverage. |

### Task 1: Structured effective route contract

**Files:**

- Modify: open-sse/utils/proxyFetch.js
- Create: tests/unit/http2-connect.test.js

**Interfaces:**

- Consumes existing loopback, NO_PROXY, environment proxy, selected-proxy, and relay helpers.
- Produces resolveEffectiveProxyRoute(targetUrl, proxyOptions).

~~~js
// Connection provenance is discriminated before egress. cacheIdentity contains no raw URL or userinfo.
{ resolutionKind: "selected-proxy", connectionProxyEnabled: true, connectionProxyUrl, connectionNoProxy, strictProxy: boolean }
{ resolutionKind: "intentional-direct", reason: "connection-no-proxy" | "legacy-proxy-disabled" | "pool-none" }
{ resolutionKind: "unselected" }
{ resolutionKind: "required-unavailable", reason, strictProxy: true }
// Effective Route values consumed by the H2 adapter.
{ kind: "direct", strictProxy: false, cacheIdentity: "direct" }
{ kind: "proxy", strictProxy: true, proxyUrl, cacheIdentity: "proxy:" + sha256(normalizedProxyUrl) }
{ kind: "relay", strictProxy: true, cacheIdentity: null }
{ kind: "required-unavailable", strictProxy: boolean, reason, cacheIdentity: null }
~~~

Add Node crypto to this module and define the cache digest in the same task.

~~~js
function hashRouteUrl(proxyUrl) {
  return crypto.createHash("sha256").update(new URL(proxyUrl).toString()).digest("hex");
}
~~~

- [ ] **Step 1: Write failing route contract tests.**

~~~js
it("selects connection proxy before environment and redacts cache identity", () => {
  const route = resolveEffectiveProxyRoute("https://agent.api5.cursor.sh/run", {
    resolutionKind: "selected-proxy",
    connectionProxyEnabled: true,
    connectionProxyUrl: "https://name:secret@proxy.test:8443",
    strictProxy: true,
  });
  expect(route).toMatchObject({ kind: "proxy", strictProxy: true });
  expect(route.cacheIdentity).not.toContain("secret");
  expect(route.cacheIdentity).not.toContain("proxy.test");
});

it("returns strict selected malformed route as required-unavailable before environment", () => {
  expect(resolveEffectiveProxyRoute("https://agent.api5.cursor.sh/run", {
    resolutionKind: "selected-proxy",
    connectionProxyUrl: "smtp://proxy.test:25",
    strictProxy: true,
  })).toMatchObject({ kind: "required-unavailable" });
  expect(getEnvProxyUrl).not.toHaveBeenCalled();
});
~~~

Add relay precedence, explicit connectionNoProxy direct route, pairless required-unavailable, missing selected strict pool, invalid selected strict URL, unsupported selected strict scheme, and non-strict malformed selected route cases. Every unavailable selected case proves zero environment lookup. Test intentional-direct inputs for legacy-proxy-disabled and pool-none also make zero environment lookup. Add one non-strict established proxy failure case separately in Task 2 because direct fallback is permitted only after that real attempt.

- [ ] **Step 2: Run the RED test.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/http2-connect.test.js --reporter=dot

Expected: FAIL because the resolver is absent.

- [ ] **Step 3: Implement the pure route resolver.**

~~~js
export function resolveEffectiveProxyRoute(targetUrl, proxyOptions = {}) {
  if (proxyOptions.resolutionKind === "required-unavailable") {
    return { kind: "required-unavailable", strictProxy: proxyOptions.strictProxy === true, reason: proxyOptions.reason || "selected-proxy-unavailable", cacheIdentity: null };
  }
  if (proxyOptions.resolutionKind === "intentional-direct") return { kind: "direct", strictProxy: false, cacheIdentity: "direct" };
  if (proxyOptions.resolutionKind === "selected-proxy") {
    if (normalizeString(proxyOptions.vercelRelayUrl)) return { kind: "relay", strictProxy: proxyOptions.strictProxy === true, cacheIdentity: null };
    if (shouldBypassByNoProxy(targetUrl, proxyOptions.connectionNoProxy)) {
      return { kind: "direct", strictProxy: false, cacheIdentity: "direct" };
    }
    const selected = resolveConnectionProxyUrl(targetUrl, proxyOptions);
    if (!selected || !isSupportedTunnelScheme(selected)) {
      return { kind: "required-unavailable", strictProxy: proxyOptions.strictProxy === true, reason: "selected-proxy-invalid", cacheIdentity: null };
    }
    if (selected && isSupportedTunnelScheme(selected)) return { kind: "proxy", strictProxy: proxyOptions.strictProxy === true, proxyUrl: selected, cacheIdentity: "proxy:" + hashRouteUrl(selected) };
  }
  // Only no selected provenance may consult environment policy.
  const proxyUrl = normalizeProxyUrl(getEnvProxyUrl(targetUrl));
  if (!proxyUrl) return { kind: "direct", strictProxy: false, cacheIdentity: "direct" };
  return { kind: "proxy", strictProxy: false, proxyUrl, cacheIdentity: "proxy:" + hashRouteUrl(proxyUrl) };
}
~~~

Call it from proxyAwareFetch so existing fetch behavior retains selected-proxy precedence and ordinary non-strict direct fallback only after an egress-capable proxy route attempted transport. Never call environment resolution for required-unavailable, relay, malformed or unsupported selected selection, or an explicit connectionNoProxy direct decision.

~~~js
function isSupportedTunnelScheme(proxyUrl) {
  return ["http:", "https:", "socks:", "socks4:", "socks4a:", "socks5:", "socks5h:"].includes(new URL(proxyUrl).protocol);
}
~~~

- [ ] **Step 4: Run route regression tests.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/http2-connect.test.js unit/strict-proxy-propagation.test.js --reporter=dot

Expected: new route cases and current strict propagation cases pass.

- [ ] **Step 5: Commit.**

~~~bash
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 add open-sse/utils/proxyFetch.js tests/unit/http2-connect.test.js
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 commit -m "feat(proxy): resolve structured egress routes"
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 log --oneline -1
~~~

### Task 2: Node HTTP/2 tunnel SessionLease

**Files:**

- Create: open-sse/utils/http2Connect.js
- Modify: tests/unit/http2-connect.test.js

**Interfaces:**

- Consumes a Route from Task 1 and socks-proxy-agent.
- Produces connectHttp2(url, { route, signal, primitives }) resolving only after one H2 session exists.

~~~js
export async function connectHttp2(url, { route, signal, primitives = nodePrimitives }) {
  // Return { session, effectiveRoute, close }.
}
const primitives = { netConnect, tlsConnect, http2Connect, createSocksAgent };
~~~

Define test and production helpers in this task, then keep them module-private.

~~~js
const target = "https://agent.api5.cursor.sh/agent.v1.AgentService/Run";
function proxyRoute(proxyUrl, strictProxy = true) {
  return { kind: "proxy", proxyUrl, strictProxy, cacheIdentity: "proxy:test" };
}
function requiredUnavailableError(route) {
  return Object.assign(new Error(route.reason || "Required proxy is unavailable"), { code: "required_proxy_unavailable" });
}
function unsupportedRelayError() {
  return Object.assign(new Error("Relay does not support HTTP/2 tunnelling"), { code: "unsupported_proxy_route" });
}
const nodePrimitives = { netConnect, tlsConnect, http2Connect, createSocksAgent };
~~~

- [ ] **Step 1: Add failing tunnel lifecycle tests.**

~~~js
it.each(["http:", "https:"])("uses verified %s CONNECT before target TLS", async (scheme) => {
  const lease = await connectHttp2(target, {
    route: proxyRoute(scheme + "//user:pass@proxy.test:8443"),
    primitives: fake,
  });
  expect(fake.http2Connect).toHaveBeenCalledWith(origin, expect.objectContaining({
    createConnection: expect.any(Function),
  }));
  expect(lease.effectiveRoute.kind).toBe("proxy");
});

it("closes failed proxy resources once before non-strict direct fallback", async () => {
  const lease = await connectHttp2(target, {
    route: proxyRoute("http://proxy.test:8080", false),
    primitives: failingProxyThenDirect,
  });
  expect(failingProxyThenDirect.proxySocket.destroy).toHaveBeenCalledTimes(1);
  expect(lease.effectiveRoute).toMatchObject({ kind: "direct" });
});
~~~

Add direct, SOCKS4/4a/5/5h selection, Basic authorization only from URL userinfo, partial CONNECT buffering, non-200 CONNECT rejection, unlisted scheme rejection, pre-abort and every pending-stage abort, relay/unavailable zero primitive calls, strict no fallback, and idempotent close.

- [ ] **Step 2: Run the RED transport suite.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/http2-connect.test.js --reporter=dot

Expected: FAIL because http2Connect.js is absent.

- [ ] **Step 3: Implement transport stages and one-close lease ownership.**

~~~js
async function openProxyTunnel(target, route, signal, primitives) {
  if (route.kind === "required-unavailable") throw requiredUnavailableError(route);
  if (route.kind === "relay") throw unsupportedRelayError();
  if (route.kind === "direct") return null;
  // http uses TCP then CONNECT. https uses verified TLS to proxy then CONNECT.
  // socks variants use the installed agent to obtain one tunnel stream.
}

function makeLease(session, tunnel, effectiveRoute) {
  let closed = false;
  return {
    session,
    effectiveRoute,
    close() {
      if (closed) return;
      closed = true;
      try { session.close(); } finally { tunnel?.destroy(); }
    },
  };
}
~~~

Use ALPNProtocols h2 for target TLS. For HTTPS proxy TLS set servername to proxy hostname and leave certificate verification enabled. Remove all abort listeners after settlement. Destroy failed tunnel/session once before non-strict direct retry. Never use rejectUnauthorized false, raw URL logging, or relay TCP behavior.

- [ ] **Step 4: Run the transport suite.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/http2-connect.test.js --reporter=dot

Expected: all fake direct, proxy, SOCKS, fallback, abort, and cleanup cases pass.

- [ ] **Step 5: Commit.**

~~~bash
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 add open-sse/utils/http2Connect.js tests/unit/http2-connect.test.js
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 commit -m "feat(cursor): add HTTP2 proxy tunnel adapter"
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 log --oneline -1
~~~

### Task 3: Cursor AgentService timing, abort, protobuf, and thinking boundary

**Files:**

- Modify: open-sse/executors/cursor.js
- Modify: tests/unit/cursor-connect-timeout.test.js
- Modify: tests/unit/cursor-agent-proto.test.js
- Modify: tests/unit/cursor-composer-thinking.test.js

**Interfaces:**

- Consumes resolveEffectiveProxyRoute, connectHttp2, and createExecutorResponseHeaderTimeout.
- Produces resolveCursorAgentModel and async openAgentHttp2Stream(url, headers, signal, proxyOptions, connectTimeout).

~~~js
export function resolveCursorAgentModel(model) {
  const value = String(model || "");
  return /^claude-fable-/i.test(value) && value.endsWith("-fast")
    ? value.slice(0, -"-fast".length)
    : value;
}
const requestedModel = agentMessage(9, agentMessage(1, agentString(1, resolveCursorAgentModel(model))));
~~~

- [ ] **Step 1: Add failing AgentService tests.**

~~~js
it("passes composed deadline signal and resolved route to adapter", async () => {
  await new CursorExecutor({ connectHttp2: connector }).execute(agentArgs({
    proxyOptions: strictProxyOptions,
  }));
  expect(connector).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    route: expect.objectContaining({ kind: "proxy" }),
    signal: expect.any(AbortSignal),
  }));
});

it("encodes RequestedModel field 1 only and normalizes only Fable fast", () => {
  const requested = decodeRequestedModel(buildAgentRunFrame(
    [{ role: "user", content: "hi" }],
    "claude-fable-5-thinking-max-fast",
  ));
  expect(requested.has(7)).toBe(false);
  expect(readString(requested, 1)).toBe("claude-fable-5-thinking-max");
});
~~~

Cover deadline during direct/proxy setup as ConnectTimeoutError, exact caller abort before setup and after headers, listener cleanup, one lease close for request error/end/abort, and Agent update field 14 ending without reasoning_content in JSON or SSE. Assert Opus, GPT, Grok, claude-fable-fast-extra, and non-Fable fast pass through unchanged.

- [ ] **Step 2: Run focused RED tests.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/cursor-connect-timeout.test.js unit/cursor-agent-proto.test.js unit/cursor-composer-thinking.test.js --reporter=dot

Expected: FAIL because AgentService setup is synchronous, directly uses http2.connect, and writes field 7.

- [ ] **Step 3: Implement asynchronous AgentService setup.**

~~~js
const deadline = createExecutorResponseHeaderTimeout({
  connectTimeout,
  registryTimeout: this.config?.timeoutMs,
  envTimeout: FETCH_CONNECT_TIMEOUT_MS,
  signal,
});
const route = resolveEffectiveProxyRoute(url, proxyOptions);
const lease = await this.connectHttp2(url, { route, signal: deadline.signal });
const req = lease.session.request(requestHeaders);
req.once("response", headers => {
  deadline.clear();
  resolveHeaders(headers);
});
~~~

Compose parent abort into the existing per-request controller before the adapter call. Classify setup errors with deadline.classify while preserving caller reasons. After headers remove only header-deadline listeners. Route all request/session/tunnel cleanup through one lease close. Pass proxyOptions from execute through executeAgent. Remove the field-7 boolean and keep internal Agent reasoning ignored.

- [ ] **Step 4: Run AgentService adjacency tests.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/cursor-connect-timeout.test.js unit/cursor-agent-proto.test.js unit/cursor-agent-exec-request.test.js unit/cursor-composer-thinking.test.js --reporter=dot

Expected: current and new AgentService cases pass without a live connection.

- [ ] **Step 5: Commit.**

~~~bash
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 add open-sse/executors/cursor.js tests/unit/cursor-connect-timeout.test.js tests/unit/cursor-agent-proto.test.js tests/unit/cursor-composer-thinking.test.js
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 commit -m "fix(cursor): route AgentService through HTTP2 lease"
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 log --oneline -1
~~~

### Task 4: Route-aware Cursor catalog cache

**Files:**

- Modify: open-sse/services/cursorModels.js
- Modify: tests/unit/cursor-models.test.js

**Interfaces:**

- Consumes Tasks 1 and 2.
- Produces resolveCursorModels(credentials, { proxyOptions, signal, connectHttp2, http2Post, forceRefresh, log }).

~~~js
const lease = await connectHttp2(url, { route, signal });
const response = await http2Post(lease.session, headers, new Uint8Array(), { signal });
// http2Post borrows the session. Catalog owns one finally { lease.close(); }.
~~~

- [ ] **Step 1: Replace global fetch assumptions with failing seam tests.**

~~~js
function protoResponse(models) {
  return { status: 200, body: encodeUsableModels(models) };
}
function encodeUsableModels(models) {
  return concat(...models.map(({ id, name }) => model(id, name)));
}

it("separates direct and proxied cache entries", async () => {
  await resolveCursorModels(credentials, { proxyOptions: direct, connectHttp2: connector, http2Post: post });
  await resolveCursorModels(credentials, { proxyOptions: proxyA, connectHttp2: connector, http2Post: post });
  expect(post).toHaveBeenCalledTimes(2);
});

it("closes fallback-to-direct lease on direct cache hit without posting", async () => {
  await resolveCursorModels(credentials, { proxyOptions: direct, connectHttp2: directConnector, http2Post: post });
  await resolveCursorModels(credentials, { proxyOptions: nonStrictProxy, connectHttp2: proxyFailsThenDirect, http2Post: post });
  expect(post).toHaveBeenCalledTimes(1);
  expect(proxyFailsThenDirect.lease.close).toHaveBeenCalledTimes(1);
});

it("forceRefresh bypasses a seeded direct cache and overwrites its effective-route entry", async () => {
  const oldModels = [{ id: "old", name: "Old" }];
  const newModels = [{ id: "new", name: "New" }];
  const seedPost = vi.fn().mockResolvedValue(protoResponse(oldModels));
  const forcedPost = vi.fn().mockResolvedValue(protoResponse(newModels));
  await resolveCursorModels(credentials, { proxyOptions: direct, connectHttp2: connector, http2Post: seedPost });
  await resolveCursorModels(credentials, { forceRefresh: true, proxyOptions: direct, connectHttp2: connector, http2Post: forcedPost });
  expect(forcedPost).toHaveBeenCalledTimes(1);
  await expect(resolveCursorModels(credentials, { proxyOptions: direct, connectHttp2: connector, http2Post: vi.fn() })).resolves.toEqual({ models: newModels });
});
~~~

Add direct and strict fixed-route hits, successful proxy hit, two proxy identities, relay/unavailable zero connector/post/cache-read, and ordinary catalog failure returning null for static fallback. Add a seeded strict-proxy forceRefresh and a non-strict proxy-to-direct forceRefresh case. Each forced request must call post, bypass every cache read, close its returned lease once, and overwrite only the adapter-returned effective-route key. The catalog suite therefore grows from its current three explicit tests by at least seven named cache-contract tests before it may be green.

- [ ] **Step 2: Run the RED catalog suite.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/cursor-models.test.js --reporter=dot

Expected: FAIL because current catalog uses raw http2.connect and a credential-only key.

- [ ] **Step 3: Implement effective-route cache ordering.**

~~~js
if (route.kind === "relay" || route.kind === "required-unavailable") {
  return { unavailable: true, reason: route.reason || route.kind };
}
const cacheReadable = options.forceRefresh !== true;
if (cacheReadable && (route.kind === "direct" || route.strictProxy)) {
  const cached = readFresh(cacheKey(credentials, route.cacheIdentity));
  if (cached) return { models: cached.models };
}
const lease = await connectHttp2(url, { route, signal });
try {
  const key = cacheKey(credentials, lease.effectiveRoute.cacheIdentity);
  const cached = cacheReadable ? readFresh(key) : null;
  if (cached) return { models: cached.models };
  const models = await parseCatalogResponse(await http2Post(lease.session, headers, body, { signal }));
  storeCatalog(key, models);
  return { models };
} finally {
  lease.close();
}
~~~

The key hashes cursor, machine ID, access token, and effective route identity. Direct/strict routes may read cache before transport only when forceRefresh is false. A forced call never reads any direct, selected-proxy, or fallback effective-route cache, always posts, then replaces the entry for its effective route. Non-strict proxy routes establish first, then use the adapter-returned route. A failed proxy attempt is adapter-owned and cannot warm/read proxy cache. Do not turn ordinary catalog errors into typed unavailable.

- [ ] **Step 4: Run cache and adapter tests.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/cursor-models.test.js unit/http2-connect.test.js --reporter=dot

Expected: cache partition, close-on-hit, and no-egress tests pass.

- [ ] **Step 5: Commit.**

~~~bash
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 add open-sse/services/cursorModels.js tests/unit/cursor-models.test.js
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 commit -m "fix(cursor): partition live catalog by egress route"
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 log --oneline -1
~~~

### Task 5: Strict snapshot lifecycle and pool fan-out

**Files:**

- Modify: src/lib/db/repos/connectionsRepo.js
- Modify: src/lib/db/repos/settingsRepo.js
- Modify: src/lib/db/repos/proxyPoolsRepo.js
- Modify: src/lib/db/index.js
- Modify: src/lib/localDb.js
- Modify: src/models/index.js
- Modify: src/app/api/providers/route.js
- Modify: src/app/api/providers/[id]/route.js
- Modify: src/app/api/settings/route.js
- Modify: src/app/api/proxy-pools/[id]/route.js
- Create: tests/unit/proxy-pool-strict-snapshot.test.js
- Modify: tests/unit/strict-proxy-propagation.test.js
- Modify: tests/unit/settings-connect-timeout.test.js

**Interfaces:**

- Consumes current SQLite transaction adapter, encrypted connection data, and settings JSON.
- Produces conditional snapshot writers and updateProxyPoolWithBoundSnapshots(id, updates).

~~~js
// Only this server-owned pair is durable selection state.
{ proxyPoolId: "pool-id", strictProxy: true }
// One transaction writes the pool and every record still bound to pool-id.
await updateProxyPoolWithBoundSnapshots(poolId, updates);
~~~

The repository exports the following conditional writers for the migration
owner in Task 6. Each returns the durable record or null when a concurrent
selection changed its expected pool ID.

~~~js
updateConnectionProxyPoolSnapshotIfBound(connectionId, expectedPoolId, pair)
updateProviderStrategyProxyPoolSnapshotIfBound(providerId, expectedPoolId, pair)
~~~

- [ ] **Step 1: Write failing real SQLite snapshot tests.**

~~~js
it("updates normal and no-auth snapshots in one pool PUT transaction", async () => {
  await createBoundConnectionAndStrategy("pool-a", false);
  const response = await poolPUT("pool-a", { strictProxy: true });
  expect(response.status).toBe(200);
  expect(await storedConnectionPair()).toEqual({ proxyPoolId: "pool-a", strictProxy: true });
  expect(await storedStrategyPair()).toEqual({ proxyPoolId: "pool-a", strictProxy: true });
});

it("rolls back pool and snapshots when a fan-out write fails", async () => {
  const before = await readAllThreeRecords();
  expect((await failingPoolPUT()).status).toBe(500);
  expect(await readAllThreeRecords()).toEqual(before);
});
~~~

Add active-pool POST/PUT selection, clear deleting both fields, client strict mismatch rejection, unrelated token refresh preservation, concurrent reassignment retaining its new pool snapshot, fixed and rotating no-auth strategy behavior.

- [ ] **Step 2: Run persistence RED tests.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/proxy-pool-strict-snapshot.test.js unit/strict-proxy-propagation.test.js unit/settings-connect-timeout.test.js --reporter=dot

Expected: FAIL because current write paths retain only proxyPoolId and pool PUT does not fan out.

- [ ] **Step 3: Implement pair-aware API and repository writes.**

~~~js
async function normalizeSelectedPool(proxyPoolId) {
  if (isClear(proxyPoolId)) return { proxyPoolId: null, strictProxy: null };
  const pool = await getProxyPoolById(String(proxyPoolId).trim());
  if (!pool?.isActive || !normalizeString(pool.proxyUrl)) throw new ProxyPoolValidationError();
  return { proxyPoolId: pool.id, strictProxy: pool.strictProxy === true };
}
function applySelection(data, selection) {
  if (selection.proxyPoolId === null) {
    delete data.proxyPoolId;
    delete data.strictProxy;
  } else {
    Object.assign(data, selection);
  }
}
~~~

Pool repository writes pool, matching decrypted/re-encrypted normal connection data, and settings.providerStrategies entries in one db.transaction. It updates only records still bound to target pool and leaves unrelated data intact. Any error throws from transaction. POST, PUT, and settings PATCH obtain strict only from selected active pool and reject standalone/mismatched client strict input.

- [ ] **Step 4: Run persistence tests.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/proxy-pool-strict-snapshot.test.js unit/strict-proxy-propagation.test.js unit/settings-connect-timeout.test.js --reporter=dot

Expected: lifecycle, rollback, concurrency, and existing settings tests pass.

- [ ] **Step 5: Commit.**

~~~bash
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 add src/lib/db/repos/connectionsRepo.js src/lib/db/repos/settingsRepo.js src/lib/db/repos/proxyPoolsRepo.js src/lib/db/index.js src/lib/localDb.js src/models/index.js src/app/api/providers/route.js src/app/api/providers/[id]/route.js src/app/api/settings/route.js src/app/api/proxy-pools/[id]/route.js tests/unit/proxy-pool-strict-snapshot.test.js tests/unit/strict-proxy-propagation.test.js tests/unit/settings-connect-timeout.test.js
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 commit -m "fix(proxy): persist strict pool selection snapshots"
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 log --oneline -1
~~~

### Task 6: Pre-egress migration and credential ownership

**Files:**

- Modify: src/lib/network/connectionProxy.js
- Modify: src/sse/services/auth.js
- Modify: open-sse/services/tokenRefresh.js
- Modify: tests/unit/strict-proxy-propagation.test.js
- Modify: tests/unit/settings-connect-timeout.test.js

**Interfaces:**

- Consumes Task 5 conditional connection and strategy snapshot writers.
- Produces typed resolver outcome and safe proxy-options conversion.

~~~js
export async function resolveConnectionProxyConfig(data, { persistPoolSnapshot } = {}) {
  // { kind: "usable", resolutionKind: "selected-proxy" | "intentional-direct" | "unselected", ...proxy fields } or
  // { kind: "required-unavailable", proxyPoolId, strictProxy: boolean, reason }
}
export function toConnectionProxyOptions(config) {
  if (config.kind !== "usable") throw new RequiredProxyUnavailableError(config.reason);
  return {
    connectionProxyEnabled: config.connectionProxyEnabled === true,
    connectionProxyUrl: config.connectionProxyUrl || "",
    connectionNoProxy: config.connectionNoProxy || "",
    vercelRelayUrl: config.vercelRelayUrl || "",
    strictProxy: config.strictProxy === true,
    resolutionKind: config.resolutionKind,
  };
}
export class RequiredProxyUnavailableError extends Error {
  constructor(reason) {
    super("Required proxy is unavailable");
    this.name = "RequiredProxyUnavailableError";
    this.code = "required_proxy_unavailable";
    this.status = 503;
    this.reason = reason;
  }
}
export const isRequiredProxyUnavailableError = error => error?.code === "required_proxy_unavailable";
~~~

Define the control helpers in connectionProxy.js. They preserve pool and legacy
per-connection selection provenance when lookup fails. A missing or malformed
selected route is not rewritten to unselected, so it cannot become environment
or direct egress by accident. An explicitly disabled legacy configuration also
never becomes unselected. Its strict form is unavailable and its non-strict
form is explicit connection-local direct.

~~~js
function requiredUnavailable(reason, proxyPoolId, strictProxy = true) {
  return { kind: "required-unavailable", reason, proxyPoolId, strictProxy, resolutionKind: "required-unavailable" };
}
function usableConfigFromPool(pool, pair) {
  return {
    kind: "usable", resolutionKind: "selected-proxy", source: "pool", proxyPoolId: pair.proxyPoolId,
    connectionProxyEnabled: pool.type !== "vercel" && pool.type !== "cloudflare",
    connectionProxyUrl: pool.proxyUrl || "", connectionNoProxy: pool.noProxy || "",
    vercelRelayUrl: pool.type === "vercel" || pool.type === "cloudflare" ? pool.proxyUrl : "",
    strictProxy: pair.strictProxy,
  };
}
function hasOwn(data, key) {
  return Object.prototype.hasOwnProperty.call(data || {}, key);
}
function normalizeLegacyProxy(data = {}) {
  return {
    hasLegacySelection: ["connectionProxyEnabled", "connectionProxyUrl", "connectionNoProxy", "strictProxy"].some(key => hasOwn(data, key)),
    hasConnectionProxyEnabled: hasOwn(data, "connectionProxyEnabled"),
    connectionProxyEnabled: data.connectionProxyEnabled === true,
    connectionProxyUrl: normalizeString(data.connectionProxyUrl),
    connectionNoProxy: normalizeString(data.connectionNoProxy),
    strictProxy: data.strictProxy === true,
  };
}
function usableLegacyConfig(legacy) {
  if (!legacy.hasLegacySelection) return null;
  if (!legacy.hasConnectionProxyEnabled) {
    return requiredUnavailable("legacy-proxy-enabled-missing", null, legacy.strictProxy);
  }
  if (legacy.connectionProxyEnabled !== true) {
    return legacy.strictProxy
      ? requiredUnavailable("legacy-proxy-disabled", null, true)
      : { kind: "usable", resolutionKind: "intentional-direct", source: "legacy", reason: "legacy-proxy-disabled", ...legacy };
  }
  if (!legacy.connectionProxyUrl || !isSupportedConnectionProxyUrl(legacy.connectionProxyUrl)) {
    return requiredUnavailable("legacy-proxy-invalid", null, legacy.strictProxy);
  }
  return { kind: "usable", resolutionKind: "selected-proxy", source: "legacy", ...legacy };
}
~~~

`isSupportedConnectionProxyUrl` is a local pure parser with exactly the Task 1
tunnel-scheme allowlist. Do not import a Node HTTP/2 helper into this browser-safe
configuration module. Pool selection wins over legacy data. `proxyPoolId ===
"__none__"` returns usable `intentional-direct` with reason `pool-none` before
legacy evaluation. `unselected` is returned only when there is no pool selection
and none of the four legacy proxy keys is present. `toConnectionProxyOptions`
must preserve `resolutionKind` and the complete legacy URL, enabled, no-proxy,
and strict fields without converting a legacy result into unselected.

Use this legacy matrix after pool selection and before any unselected result.
The `effective route` column is evaluated for a non-matching target, except for
the explicit no-proxy row. Every row other than `unselected` must prove that
`getEnvProxyUrl` is never called.

| Legacy fields | Resolver outcome | Effective route and egress policy |
| --- | --- | --- |
| enabled true, valid supported URL, strict true | usable `selected-proxy` with URL and strict true | proxy only, no direct fallback |
| enabled true, valid supported URL, strict false | usable `selected-proxy` with URL and strict false | proxy first, direct only after the Task 2 proxy transport fails |
| enabled true, missing, malformed, or unsupported URL, strict true | `required-unavailable` `legacy-proxy-invalid` | no environment lookup, direct, catalog, or transport |
| enabled true, missing, malformed, or unsupported URL, strict false | `required-unavailable` `legacy-proxy-invalid` | no environment lookup or direct retry before a real proxy attempt |
| enabled false, any URL, strict true | `required-unavailable` `legacy-proxy-disabled` | no environment lookup, direct, catalog, or transport |
| enabled false, any URL, strict false | usable `intentional-direct` `legacy-proxy-disabled` | direct from the explicit connection-local decision, no environment lookup |
| enabled absent with any legacy URL, no-proxy, or strict key | `required-unavailable` `legacy-proxy-enabled-missing` | no environment lookup, direct, catalog, or transport |
| enabled true, valid URL, target matches connectionNoProxy | usable `selected-proxy` | direct with reason `connection-no-proxy`, no environment lookup |
| no pool selection and no legacy proxy keys | usable `unselected` | environment policy may resolve proxy or direct |

- [ ] **Step 1: Add failing migration tests.**

~~~js
it("persists legacy pair before usable normal credentials", async () => {
  const result = await resolveConnectionProxyConfig(
    { proxyPoolId: "pool-strict" },
    { persistPoolSnapshot },
  );
  expect(persistPoolSnapshot).toHaveBeenCalledWith({
    proxyPoolId: "pool-strict",
    strictProxy: true,
  });
  expect(result.kind).toBe("usable");
});

it.each(["missing", "inactive", "malformed", "lookup-throws", "write-fails", "no-owner"])(
  "fails pairless %s before egress",
  async state => {
    expect((await resolveLegacy(state)).kind).toBe("required-unavailable");
    expect(egressPrimitives).not.toHaveBeenCalled();
  },
);
~~~

Add the nine matrix rows as named strict and non-strict legacy tests. They must
assert the complete `resolutionKind`, URL, enabled, and strict fields before
calling `resolveEffectiveProxyRoute`; every non-unselected case asserts no
environment lookup. Add already-persisted strict disappearance/deactivation/
malformed/throw cases, no-auth fixed durable write, rotating pair carry-through,
and refresh preservation.

- [ ] **Step 2: Run migration RED tests.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/strict-proxy-propagation.test.js unit/settings-connect-timeout.test.js unit/http2-connect.test.js --reporter=dot

Expected: FAIL because current resolver treats missing selection as direct-capable state.

- [ ] **Step 3: Implement migration barrier.**

~~~js
if (proxyPoolId && typeof storedStrict !== "boolean") {
  if (!persistPoolSnapshot || !activePool) {
    return requiredUnavailable("legacy-pool-snapshot-unavailable", proxyPoolId);
  }
  const pair = { proxyPoolId, strictProxy: activePool.strictProxy === true };
  await persistPoolSnapshot(pair);
  return usableConfigFromPool(activePool, pair);
}
if (proxyPoolId && (!activePool || activePool.isActive !== true || !proxyUrl)) {
  return requiredUnavailable("selected-pool-unavailable", proxyPoolId, storedStrict === true);
}
const legacyResult = usableLegacyConfig(normalizeLegacyProxy(providerSpecificData));
if (legacyResult) return legacyResult;
return { kind: "usable", resolutionKind: "unselected", source: "none", ...normalizeLegacyProxy(providerSpecificData) };
~~~

Auth supplies conditional normal-connection and no-auth strategy persistence owners. It returns null before handing unavailable credentials to transports and copies trusted pair into provider data/options. Token refresh starts from existing providerSpecificData so neither field is erased. Keep `__none__` as intentional direct selection. A non-strict direct retry remains legal only after Task 2 receives an egress-capable proxy Route and its proxy transport actually fails.

- [ ] **Step 4: Run auth adjacency tests.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/strict-proxy-propagation.test.js unit/settings-connect-timeout.test.js unit/chat-connect-timeout-propagation.test.js --reporter=dot

Expected: pairless states make no egress while ordinary non-strict fallback remains covered.

- [ ] **Step 5: Commit.**

~~~bash
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 add src/lib/network/connectionProxy.js src/sse/services/auth.js open-sse/services/tokenRefresh.js tests/unit/strict-proxy-propagation.test.js tests/unit/settings-connect-timeout.test.js
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 commit -m "fix(proxy): fail closed for unmigrated selections"
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 log --oneline -1
~~~

### Task 7: Typed unavailable boundaries

**Files:**

- Modify: src/sse/services/quotaGuard.js
- Modify: src/shared/services/quotaAutoPing.js
- Modify: src/app/api/usage/[connectionId]/route.js
- Modify: src/app/api/usage/[connectionId]/codex-reset-credits/route.js
- Modify: src/app/api/providers/[id]/hotreload/route.js
- Modify: src/app/api/providers/[id]/test/testUtils.js
- Create: tests/unit/required-unavailable-callers.test.js

**Interfaces:**

- Consumes Task 6 resolver and options converter.
- Produces one explicit required_proxy_unavailable branch before options, refresh, quota, test, or usage work.

- [ ] **Step 1: Add failing zero-egress caller tests.**

~~~js
it.each([
  ["quota guard", runQuotaGuard, "getUsageForProvider"],
  ["auto ping", runAutoPing, "handler.getUsage"],
  ["usage", runUsageRoute, "refreshAndUpdateCredentials"],
  ["codex reset", runCodexReset, "consumeCodexRateLimitResetCredit"],
  ["hot reload", runHotReload, "refreshAndUpdateCredentials"],
  ["provider test", runProviderTest, "testProxyUrl"],
])("%s stops before %s", async (_name, invoke, forbidden) => {
  await expect(invoke(requiredUnavailable)).resolves.toMatchObject({
    code: "required_proxy_unavailable",
  });
  expect(spies[forbidden]).not.toHaveBeenCalled();
});
~~~

For HTTP routes assert status 503 with error Required proxy is unavailable and code required_proxy_unavailable. Quota guard returns its existing no-live result with this code. Auto-ping records/skips without credential refresh. Assert no branch builds former strictProxy false options.

- [ ] **Step 2: Run the RED caller suite.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/required-unavailable-callers.test.js --reporter=dot

Expected: FAIL because current paths make ordinary non-strict options from failed selections.

- [ ] **Step 3: Add boundary checks.**

~~~js
const proxyConfig = await resolveConnectionProxyConfig(
  connection.providerSpecificData,
  {
    persistPoolSnapshot: pair => updateConnectionProxyPoolSnapshotIfBound(
      connection.id,
      connection.providerSpecificData?.proxyPoolId,
      pair,
    ),
  },
);
if (proxyConfig.kind === "required-unavailable") {
  return Response.json({
    error: "Required proxy is unavailable",
    code: "required_proxy_unavailable",
  }, { status: 503 });
}
const proxyOptions = toConnectionProxyOptions(proxyConfig);
~~~

For quota code return its documented no-live result. For provider testing return existing failed-test shape with valid false, zero latency, and typed code. Do not catch control results and rebuild a direct-capable options object.

- [ ] **Step 4: Run caller and strict tests.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/required-unavailable-callers.test.js unit/strict-proxy-propagation.test.js --reporter=dot

Expected: typed failures make zero forbidden calls.

- [ ] **Step 5: Commit.**

~~~bash
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 add src/sse/services/quotaGuard.js src/shared/services/quotaAutoPing.js src/app/api/usage/[connectionId]/route.js src/app/api/usage/[connectionId]/codex-reset-credits/route.js src/app/api/providers/[id]/hotreload/route.js src/app/api/providers/[id]/test/testUtils.js tests/unit/required-unavailable-callers.test.js
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 commit -m "fix(proxy): stop unavailable selections before egress"
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 log --oneline -1
~~~

### Task 8: Cursor model route provenance and campaign verification

**Files:**

- Modify: src/app/api/v1/models/route.js
- Modify: src/app/api/v1/models/[kind]/route.js
- Modify: src/app/api/providers/[id]/models/route.js
- Modify: src/app/api/models/new/route.js
- Modify: src/app/api/model-context/route.js
- Modify: tests/unit/cursor-models.test.js
- Modify: tests/unit/required-unavailable-callers.test.js
- Create: tests/unit/models-list-required-unavailable.test.js

**Interfaces:**

- Consumes Tasks 4 and 6.
- Produces resolver-derived Cursor proxyOptions and one required_proxy_unavailable error contract. `buildModelsList` keeps its successful Model[] return type but throws that typed error. Before it constructs any enabledModels, static, alias, custom, or live catalog list, it preflights every active Cursor connection. Every current consumer translates that error to HTTP 503 and never replaces it with static models or a generic 500.

~~~js
import {
  RequiredProxyUnavailableError,
  isRequiredProxyUnavailableError,
  resolveConnectionProxyConfig,
  toConnectionProxyOptions,
} from "@/lib/network/connectionProxy";
import {
  getProviderConnections,
  updateConnectionProxyPoolSnapshotIfBound,
} from "@/lib/localDb";
~~~

- [ ] **Step 1: Add failing model-route handoff tests.**

~~~js
it.each([runV1Models, runConnectionModels])("passes resolved Cursor proxy to catalog", async route => {
  await route(cursorConnectionWithPool);
  expect(resolveCursorModels).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
    proxyOptions: expect.objectContaining({
      strictProxy: true,
      connectionProxyEnabled: true,
    }),
  }));
});

it.each([runV1Models, runConnectionModels])("returns unavailable before Cursor catalog", async route => {
  await expect(route(unavailableCursorConnection)).resolves.toMatchObject({ status: 503 });
  expect(resolveCursorModels).not.toHaveBeenCalled();
});

const strictUnavailableCursorWithExplicitModels = {
  id: "cursor-strict-unavailable",
  provider: "cursor",
  isActive: true,
  providerSpecificData: {
    proxyPoolId: "missing-strict-pool",
    strictProxy: true,
    enabledModels: ["cursor-agent"],
  },
};

it.each([getV1Models, getModelsByKind, getNewModels, getModelContext])(
  "returns 503 before explicit Cursor enabledModels or a catalog resolver",
  async route => {
    getProviderConnections.mockResolvedValue([strictUnavailableCursorWithExplicitModels]);
    const response = await route();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ code: "required_proxy_unavailable" });
    expect(body).not.toHaveProperty("data");
    expect(resolveCursorModels).not.toHaveBeenCalled();
    if (route === getNewModels) {
      expect(getCachedResult).not.toHaveBeenCalled();
      expect(setCachedResult).not.toHaveBeenCalled();
    }
  },
);

it.each([getV1Models, getModelsByKind, getNewModels, getModelContext])(
  "uses the live Cursor catalog only for a usable active Cursor connection",
  async route => {
    getCachedResult.mockReturnValue(null);
    getProviderConnections.mockResolvedValue([usableCursorConnectionWithoutExplicitModels]);
    const response = await route();
    expect(response.status).toBe(200);
    expect(resolveCursorModels).toHaveBeenCalled();
  },
);

it("does not let a seeded new-model cache hide required Cursor proxy unavailable", async () => {
  getCachedResult.mockReturnValue({ groups: [{ providerAlias: "cursor" }], total: 1 });
  getProviderConnections.mockResolvedValue([strictUnavailableCursorWithExplicitModels]);
  const response = await getNewModels();
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "required_proxy_unavailable" });
  expect(getCachedResult).not.toHaveBeenCalled();
  expect(resolveCursorModels).not.toHaveBeenCalled();
  expect(setCachedResult).not.toHaveBeenCalled();
});

it("throws before static explicit Cursor models when buildModelsList preflight is unavailable", async () => {
  getProviderConnections.mockResolvedValue([strictUnavailableCursorWithExplicitModels]);
  await expect(buildModelsList(["llm"])).rejects.toMatchObject({
    code: "required_proxy_unavailable",
    status: 503,
  });
  expect(resolveCursorModels).not.toHaveBeenCalled();
});
~~~

Use the new model-list test file for imported route handlers and mocked dependencies. It starts at zero tests and gains four required-unavailable route cases, four normal usable-route cases, the seeded-cache case, and one direct `buildModelsList` propagation case. Each required-unavailable case has an active strict Cursor connection with explicit `enabledModels`, expects HTTP 503 with no list body, and asserts zero `resolveCursorModels` calls. Each normal route uses a usable active Cursor selection without explicit models and expects HTTP 200 plus at least one resolver call. `models/new` alone asserts cache ordering and write behavior. Together with two normal and two unavailable direct-provider resolver cases in the existing suites, this task adds 14 expanded cases. The focused model command below covers those 14 cases plus existing cursor-model and generic caller assertions. Record the complete Vitest expansion only from the implementation run, because the baseline suite count is not established in this planning worktree.

- [ ] **Step 2: Run RED model handoff tests.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/cursor-models.test.js unit/required-unavailable-callers.test.js unit/models-list-required-unavailable.test.js --reporter=dot

Expected: FAIL because current Cursor resolvers receive no proxy provenance, `buildModelsList` constructs explicit enabledModels before any Cursor preflight, models/new reads its cache before discovery, and consumers return normal/static or generic 500 responses.

- [ ] **Step 3: Thread safe resolved options only.**

~~~js
const connectionOwner = connection => ({
  persistPoolSnapshot: pair => updateConnectionProxyPoolSnapshotIfBound(
    connection.id,
    connection.providerSpecificData?.proxyPoolId,
    pair,
  ),
});
const cursorCredentials = connection => ({
  accessToken: connection.accessToken,
  providerSpecificData: connection.providerSpecificData || {},
});
const requiredUnavailableResult = () => ({
  error: "Required proxy is unavailable",
  status: 503,
  code: "required_proxy_unavailable",
});
export async function assertCursorModelEgressAvailable(connections = null) {
  const activeConnections = (connections || await getProviderConnections())
    .filter(connection => connection.isActive !== false && connection.provider === "cursor");
  for (const connection of activeConnections) {
    const config = await resolveConnectionProxyConfig(connection.providerSpecificData, connectionOwner(connection));
    if (config.kind === "required-unavailable") throw new RequiredProxyUnavailableError(config.reason);
  }
}
export async function buildModelsList(kindFilter) {
  let connections = [];
  try {
    connections = (await getProviderConnections())
      .filter(connection => connection.isActive !== false);
  } catch (error) {
    console.log("Could not fetch providers, returning all models");
  }
  await assertCursorModelEgressAvailable(connections);
  // Only after this line may enabledModels, static, alias, or custom lists form.
  // ... existing successful Model[] assembly
}
async function resolveLiveCursorModels(connection) {
  const proxyConfig = await resolveConnectionProxyConfig(
    connection.providerSpecificData,
    connectionOwner(connection),
  );
  if (proxyConfig.kind === "required-unavailable") {
    throw new RequiredProxyUnavailableError(proxyConfig.reason);
  }
  const result = await resolveCursorModels(cursorCredentials(connection), {
    log: console,
    proxyOptions: toConnectionProxyOptions(proxyConfig),
  });
  if (result?.unavailable) throw new RequiredProxyUnavailableError(result.reason);
  return result?.models?.length ? { models: result.models } : null;
}
async function resolveDirectProviderCursorModels(connection) {
  const proxyConfig = await resolveConnectionProxyConfig(
    connection.providerSpecificData,
    connectionOwner(connection),
  );
  if (proxyConfig.kind === "required-unavailable") {
    return requiredUnavailableResult(proxyConfig);
  }
  const result = await resolveCursorModels(cursorCredentials(connection), {
    forceRefresh: true,
    log: console,
    proxyOptions: toConnectionProxyOptions(proxyConfig),
  });
  return result?.unavailable ? requiredUnavailableResult(result) : result;
}
export async function GET() { // src/app/api/models/new/route.js
  await assertCursorModelEgressAvailable(); // before getCachedResult
  const cached = getCachedResult();
  // ... existing cache/discovery flow
}
~~~

For the v1 live Cursor resolver, throw new RequiredProxyUnavailableError when the resolver or catalog result is unavailable. At the start of `buildModelsList`, immediately after the active connection read succeeds and before the branches that form `rawModelIds` from `enabledModels`, static provider models, aliases, custom models, or `LIVE_MODEL_RESOLVERS`, call `assertCursorModelEgressAvailable(connections)`. It must throw for one active required-unavailable Cursor connection, including a strict one with explicit enabledModels. That path makes zero `resolveCursorModels` calls and produces no static catalog. Export the helper from the v1 module and call it in models/new before `getCachedResult`, so a stale new-model cache cannot hide a strict required-unavailable selection. In the direct provider models resolver return the existing error/status shape with status 503 rather than its Cursor static warning. In GET handlers for v1 models, v1 model kinds, models/new, and model-context, recognize the typed error and serialize error Required proxy is unavailable with code required_proxy_unavailable and status 503. The model-context inner default-visibility catch rethrows this typed error to its outer HTTP handler. models/new does not read or populate its new-model cache on this error. Keep static fallback only for ordinary null catalog failure after successful preflight. Do not send unrelated provider fetches through the new H2 adapter. Missing, inactive, or throwing strict pool state must retain provenance and call no catalog seam.

- [ ] **Step 4: Run complete focused campaign gate.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/http2-connect.test.js unit/cursor-connect-timeout.test.js unit/cursor-models.test.js unit/cursor-agent-proto.test.js unit/cursor-agent-exec-request.test.js unit/cursor-composer-thinking.test.js unit/strict-proxy-propagation.test.js unit/settings-connect-timeout.test.js unit/proxy-pool-strict-snapshot.test.js unit/required-unavailable-callers.test.js unit/models-list-required-unavailable.test.js --reporter=dot

Expected: all selected files pass. Record Vitest actual expanded count in implementation handoff.

- [ ] **Step 5: Run static and baseline gates.**

~~~bash
cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276
npx eslint open-sse/utils/proxyFetch.js open-sse/utils/http2Connect.js open-sse/executors/cursor.js open-sse/services/cursorModels.js src/lib/network/connectionProxy.js src/lib/db/repos/connectionsRepo.js src/lib/db/repos/settingsRepo.js src/lib/db/repos/proxyPoolsRepo.js src/app/api/providers/route.js src/app/api/providers/[id]/route.js src/app/api/settings/route.js src/app/api/proxy-pools/[id]/route.js src/sse/services/auth.js open-sse/services/tokenRefresh.js src/sse/services/quotaGuard.js src/shared/services/quotaAutoPing.js src/app/api/usage/[connectionId]/route.js src/app/api/usage/[connectionId]/codex-reset-credits/route.js src/app/api/providers/[id]/hotreload/route.js src/app/api/providers/[id]/test/testUtils.js src/app/api/v1/models/route.js src/app/api/v1/models/[kind]/route.js src/app/api/providers/[id]/models/route.js src/app/api/models/new/route.js src/app/api/model-context/route.js
npm run qa:regression
npm run build
~~~

Expected: lint clean, no new baseline regression, and production build succeeds. A missing optional better-sqlite3 binding is an environment result only after focused SQL.js tests pass.

- [ ] **Step 6: Commit and scope check.**

~~~bash
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 add src/app/api/v1/models/route.js src/app/api/v1/models/[kind]/route.js src/app/api/providers/[id]/models/route.js src/app/api/models/new/route.js src/app/api/model-context/route.js tests/unit/cursor-models.test.js tests/unit/required-unavailable-callers.test.js tests/unit/models-list-required-unavailable.test.js
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 commit -m "fix(cursor): preserve proxy route for live models"
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 log --oneline -1
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 status --short
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 diff --check
~~~

## Execution Handoff

Plan complete and saved to docs/superpowers/plans/2026-08-30-cursor-h2-proxy-adaptation.md. The approved execution choice is subagent-driven. Dispatch a fresh worker per task and scope review after Tasks 2, 4, 5, 6, and 8. Tasks 1 and 5 may start in parallel after dependency preflight. Do not push, merge, deploy, or run credentialed Cursor or proxy verification in this plan.
