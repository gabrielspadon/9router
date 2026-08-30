# Cursor HTTP/2 Proxy Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Route Cursor AgentService Run and GetUsableModels through the selected effective egress without weakening strict proxy policy, response-header timing, caller abort, cache isolation, or Cursor protobuf behavior.

**Architecture:** Keep durable pool selection, effective-route resolution, HTTP/2 socket construction, Cursor streaming, and Cursor catalog caching isolated. The connection resolver returns usable selection or typed required-unavailable. The Node-only adapter owns one session lease and exposes the effective route that established it.

**Tech Stack:** Node ESM, Node http2/net/tls, installed socks-proxy-agent, SQLite adapter repositories, Next route handlers, Vitest 4.

## Global Constraints

- Adapt upstream PR 3276 behavior only. Do not apply its patch or change generic fetch, proxy rotation, dashboard, registries, dependency manifests, production services, or tracking.
- Accept only http, https, socks, socks4, socks4a, socks5, and socks5h tunnel URLs.
- Relay is not a TCP tunnel. Relay and required-unavailable make zero calls to environment proxy resolution, net, TLS, SOCKS, HTTP CONNECT, http2.connect, catalog cache, or catalog post.
- Strict selected routes never fall back to environment or direct egress. A non-strict proxy failure closes failed resources exactly once before direct fallback.
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
// Internal-only route values. cacheIdentity contains no raw URL or userinfo.
{ kind: "direct", strictProxy: false, cacheIdentity: "direct" }
{ kind: "proxy", strictProxy: true, proxyUrl, cacheIdentity: "proxy:" + sha256(normalizedProxyUrl) }
{ kind: "relay", strictProxy: true, cacheIdentity: null }
{ kind: "required-unavailable", strictProxy: true, reason, cacheIdentity: null }
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
    connectionProxyEnabled: true,
    connectionProxyUrl: "https://name:secret@proxy.test:8443",
    strictProxy: true,
  });
  expect(route).toMatchObject({ kind: "proxy", strictProxy: true });
  expect(route.cacheIdentity).not.toContain("secret");
  expect(route.cacheIdentity).not.toContain("proxy.test");
});

it("returns required-unavailable without environment resolution", () => {
  expect(resolveEffectiveProxyRoute("https://agent.api5.cursor.sh/run", {
    resolutionKind: "required-unavailable", strictProxy: true,
  })).toMatchObject({ kind: "required-unavailable" });
  expect(getEnvProxyUrl).not.toHaveBeenCalled();
});
~~~

Add relay precedence, intentional selected NO_PROXY direct route, unsupported scheme, and selected strict invalid URL cases.

- [ ] **Step 2: Run the RED test.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/http2-connect.test.js --reporter=dot

Expected: FAIL because the resolver is absent.

- [ ] **Step 3: Implement the pure route resolver.**

~~~js
export function resolveEffectiveProxyRoute(targetUrl, proxyOptions = {}) {
  if (proxyOptions.resolutionKind === "required-unavailable") {
    return { kind: "required-unavailable", strictProxy: true, reason: proxyOptions.reason || "selected-proxy-unavailable", cacheIdentity: null };
  }
  if (normalizeString(proxyOptions.vercelRelayUrl)) return { kind: "relay", strictProxy: proxyOptions.strictProxy === true, cacheIdentity: null };
  const selected = resolveConnectionProxyUrl(targetUrl, proxyOptions);
  const proxyUrl = selected || normalizeProxyUrl(getEnvProxyUrl(targetUrl));
  if (!proxyUrl) return { kind: "direct", strictProxy: false, cacheIdentity: "direct" };
  return { kind: "proxy", strictProxy: selected ? proxyOptions.strictProxy === true : false, proxyUrl, cacheIdentity: "proxy:" + hashRouteUrl(proxyUrl) };
}
~~~

Call it from proxyAwareFetch so existing fetch behavior retains selected-proxy precedence and ordinary non-strict direct fallback. Do not call environment resolution for required-unavailable.

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
~~~

Add direct and strict fixed-route hits, successful proxy hit, two proxy identities, relay/unavailable zero connector/post/cache-read, and ordinary catalog failure returning null for static fallback.

- [ ] **Step 2: Run the RED catalog suite.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/cursor-models.test.js --reporter=dot

Expected: FAIL because current catalog uses raw http2.connect and a credential-only key.

- [ ] **Step 3: Implement effective-route cache ordering.**

~~~js
if (route.kind === "relay" || route.kind === "required-unavailable") {
  return { unavailable: true, reason: route.reason || route.kind };
}
if (route.kind === "direct" || route.strictProxy) {
  const cached = readFresh(cacheKey(credentials, route.cacheIdentity));
  if (cached) return { models: cached.models };
}
const lease = await connectHttp2(url, { route, signal });
try {
  const key = cacheKey(credentials, lease.effectiveRoute.cacheIdentity);
  const cached = readFresh(key);
  if (cached) return { models: cached.models };
  return storeParsedModels(key, await http2Post(lease.session, headers, body, { signal }));
} finally {
  lease.close();
}
~~~

The key hashes cursor, machine ID, access token, and effective route identity. Direct/strict routes may read cache before transport. Non-strict proxy routes establish first, then use the adapter-returned route. A failed proxy attempt is adapter-owned and cannot warm/read proxy cache. Do not turn ordinary catalog errors into typed unavailable.

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
  // { kind: "usable", ...proxy fields } or
  // { kind: "required-unavailable", proxyPoolId, strictProxy: true, reason }
}
export function toConnectionProxyOptions(config) {
  if (config.kind !== "usable") throw new RequiredProxyUnavailableError(config.reason);
  return {
    connectionProxyEnabled: config.connectionProxyEnabled === true,
    connectionProxyUrl: config.connectionProxyUrl || "",
    connectionNoProxy: config.connectionNoProxy || "",
    vercelRelayUrl: config.vercelRelayUrl || "",
    strictProxy: config.strictProxy === true,
    resolutionKind: "usable",
  };
}
~~~

Define the control helpers in connectionProxy.js. They preserve a persisted
strict snapshot when lookup fails and make the non-strict fallback explicit.

~~~js
function requiredUnavailable(reason, proxyPoolId) {
  return { kind: "required-unavailable", reason, proxyPoolId, strictProxy: true };
}
function usableConfigFromPool(pool, pair) {
  return {
    kind: "usable", source: "pool", proxyPoolId: pair.proxyPoolId,
    connectionProxyEnabled: pool.type !== "vercel" && pool.type !== "cloudflare",
    connectionProxyUrl: pool.proxyUrl || "", connectionNoProxy: pool.noProxy || "",
    vercelRelayUrl: pool.type === "vercel" || pool.type === "cloudflare" ? pool.proxyUrl : "",
    strictProxy: pair.strictProxy,
  };
}
function legacyNonStrictFallback(data) {
  return { kind: "usable", ...normalizeLegacyProxy(data), strictProxy: false };
}
~~~

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

Add already-persisted strict disappearance/deactivation/malformed/throw cases, no-auth fixed durable write, rotating pair carry-through, and refresh preservation.

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
  return storedStrict === true
    ? requiredUnavailable("selected-pool-unavailable", proxyPoolId)
    : legacyNonStrictFallback();
}
~~~

Auth supplies conditional normal-connection and no-auth strategy persistence owners. It returns null before handing unavailable credentials to transports and copies trusted pair into provider data/options. Token refresh starts from existing providerSpecificData so neither field is erased. Keep __none__ as intentional direct selection.

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
- Modify: src/app/api/providers/[id]/models/route.js
- Modify: tests/unit/cursor-models.test.js
- Modify: tests/unit/required-unavailable-callers.test.js

**Interfaces:**

- Consumes Tasks 4 and 6.
- Produces both model routes passing resolver-derived Cursor proxyOptions or returning typed unavailable before catalog discovery.

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
~~~

- [ ] **Step 2: Run RED model handoff tests.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/cursor-models.test.js unit/required-unavailable-callers.test.js --reporter=dot

Expected: FAIL because current Cursor model resolvers receive no proxy provenance.

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
const proxyConfig = await resolveConnectionProxyConfig(
  connection.providerSpecificData,
  connectionOwner(connection),
);
if (proxyConfig.kind === "required-unavailable") {
  return requiredUnavailableResult(proxyConfig);
}
const result = await resolveCursorModels(cursorCredentials(connection), {
  log: console,
  proxyOptions: toConnectionProxyOptions(proxyConfig),
});
if (result?.unavailable) return requiredUnavailableResult(result);
~~~

Keep static fallback only for ordinary null catalog failure. Do not send unrelated provider fetches through the new H2 adapter. Missing, inactive, or throwing strict pool state must retain provenance and call no catalog seam.

- [ ] **Step 4: Run complete focused campaign gate.**

Run: cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276/tests && npx vitest run unit/http2-connect.test.js unit/cursor-connect-timeout.test.js unit/cursor-models.test.js unit/cursor-agent-proto.test.js unit/cursor-agent-exec-request.test.js unit/cursor-composer-thinking.test.js unit/strict-proxy-propagation.test.js unit/settings-connect-timeout.test.js unit/proxy-pool-strict-snapshot.test.js unit/required-unavailable-callers.test.js --reporter=dot

Expected: all selected files pass. Record Vitest actual expanded count in implementation handoff.

- [ ] **Step 5: Run static and baseline gates.**

~~~bash
cd /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276
npx eslint open-sse/utils/proxyFetch.js open-sse/utils/http2Connect.js open-sse/executors/cursor.js open-sse/services/cursorModels.js src/lib/network/connectionProxy.js src/lib/db/repos/connectionsRepo.js src/lib/db/repos/settingsRepo.js src/lib/db/repos/proxyPoolsRepo.js src/app/api/providers/route.js src/app/api/providers/[id]/route.js src/app/api/settings/route.js src/app/api/proxy-pools/[id]/route.js src/sse/services/auth.js open-sse/services/tokenRefresh.js src/sse/services/quotaGuard.js src/shared/services/quotaAutoPing.js src/app/api/usage/[connectionId]/route.js src/app/api/usage/[connectionId]/codex-reset-credits/route.js src/app/api/providers/[id]/hotreload/route.js src/app/api/providers/[id]/test/testUtils.js src/app/api/v1/models/route.js src/app/api/providers/[id]/models/route.js
npm run qa:regression
npm run build
~~~

Expected: lint clean, no new baseline regression, and production build succeeds. A missing optional better-sqlite3 binding is an environment result only after focused SQL.js tests pass.

- [ ] **Step 6: Commit and scope check.**

~~~bash
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 add src/app/api/v1/models/route.js src/app/api/providers/[id]/models/route.js tests/unit/cursor-models.test.js tests/unit/required-unavailable-callers.test.js
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 commit -m "fix(cursor): preserve proxy route for live models"
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 log --oneline -1
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 status --short
git -C /home/spadon/Codebases/9router/.claude/worktrees/task-5-pr3276 diff --check
~~~

## Execution Handoff

Plan complete and saved to docs/superpowers/plans/2026-08-30-cursor-h2-proxy-adaptation.md. The approved execution choice is subagent-driven. Dispatch a fresh worker per task and scope review after Tasks 2, 4, 5, 6, and 8. Tasks 1 and 5 may start in parallel after dependency preflight. Do not push, merge, deploy, or run credentialed Cursor or proxy verification in this plan.
