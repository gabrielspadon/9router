# Ollama Cloud Web Fetch Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, proxy-aware Ollama Cloud web-fetch adapter that remains unreachable from public discovery until the later public-contract and state subprojects are complete.

**Architecture:** Extend `handleFetchCore` with a private Ollama branch that validates the exact local contract, sends the official request through `proxyAwareFetch`, applies one caller-aware deadline through body consumption, and normalizes only a bounded JSON response. Then add minimal application plumbing for the caller signal and the already-resolved connection proxy options. Do not change the Ollama registry, public model IDs, account selection, persisted state, or fallback policy.

**Tech Stack:** ESM JavaScript, Node Web `Request` and `Response`, `AbortController`, `ReadableStream`, `TextDecoder`, existing `proxyAwareFetch`, Vitest 4, ESLint 9, Next.js 16.

## Global Constraints

- Work only in `/home/spadon/Codebases/9router/.claude/worktrees/task-6-pr3624` on `integration/task6-pr3624`.
- Own exactly `open-sse/handlers/fetch/index.js`, `src/sse/handlers/fetch.js`, and `tests/unit/ollama-web-fetch-transport.test.js` during implementation.
- Do not modify this plan or the approved design during implementation.
- Do not add `webFetch`, `fetchConfig`, or another field to `open-sse/providers/registry/ollama.js`.
- Do not modify provider discovery, model-info, routes, dashboard UI, examples, skills, account pinning, auth services, repositories, migrations, dependencies, lockfiles, or generated artifacts.
- Do not make `ollama`, `ollama/fetch`, or a fake `fetch` chat model publicly invocable.
- Use only `credentials.apiKey`. It must be a trimmed, non-empty visible-ASCII string without whitespace or control characters.
- Send only `POST https://ollama.com/api/web_fetch` with Bearer auth, JSON content type, JSON accept header, and byte-exact `JSON.stringify({ url })` body.
- Accept only `formats: ["markdown"]`, `maxCharacters: 200000`, and `timeoutMs: 30000` from the Ollama provider configuration. Missing or inconsistent configuration fails locally.
- Treat omitted or `null` format as `markdown`. Treat omitted or `null` request maximum as `200000`; accept only integers from 1 through 200000.
- Limit target URLs to 8192 UTF-8 bytes, successful response bodies to 4 MiB, error bodies to 16 KiB, errors to 512 characters, links to 100 entries, each link to 8192 UTF-8 bytes, and aggregate links to 64 KiB.
- Preserve the existing UTF-16 `content.length` convention and never cut after an unmatched high surrogate.
- One 30000 ms deadline covers transport, response headers, and the complete bounded body read. Caller abort retains its original reason and wins only when observed first.
- Preserve the exact selected proxy fields `connectionProxyEnabled`, `connectionProxyUrl`, `connectionNoProxy`, `vercelRelayUrl`, and `strictProxy`.
- A strict proxy failure makes zero direct Ollama attempts. Cleanup cancellation is best-effort, rejection-owned, and cannot replace the primary result.
- Keep existing Firecrawl, Jina Reader, Tavily, and Exa behavior unchanged. Do not migrate them to the Ollama transport seam.
- Return the current `{ success, status?, error?, data? }` envelope plus an optional adapter-local `code`. Do not decide account rotation or persisted error scope.
- Use strict TDD. Record each intentional RED before production edits, then record GREEN before each commit.
- Make exactly two implementation commits. Do not push, deploy, start a server, spend Ollama quota, or use production credentials.

---

## File Map

### Created during implementation

- `tests/unit/ollama-web-fetch-transport.test.js` contains all 78 deterministic Transport tests. The core section has 76 tests and the application-plumbing section has 2 tests.

### Modified during implementation

- `open-sse/handlers/fetch/index.js` owns Ollama request validation, adapter-local error codes, total deadline composition, bounded stream consumption, response validation, link validation, safe truncation, and the Ollama dispatch branch.
- `src/sse/handlers/fetch.js` owns one private proxy-options builder and passes `request.signal` plus proxy options into `handleFetchCore`. It does not change provider resolution, credential selection, refresh, account clearing, fallback, or response construction.

### Explicitly unchanged

- `open-sse/providers/registry/ollama.js` remains `serviceKinds: ["llm"]` with no `fetchConfig`.
- `src/app/api/v1/models/route.js`, `src/app/api/v1/models/info/route.js`, and dashboard components remain unchanged.
- `src/sse/services/auth.js` and every connection repository remain unchanged.
- `skills/9router-web-fetch/SKILL.md`, package manifests, lockfiles, and generated registry files remain unchanged.

## Private Interfaces

Keep the helpers private to their owned modules. Do not export internals only to make tests easier.

```js
// open-sse/handlers/fetch/index.js
FetchResult = {
  success: boolean,
  status?: number,
  error?: string,
  code?: string,
  data?: object,
}

FetchProxyOptions = {
  connectionProxyEnabled: boolean,
  connectionProxyUrl: string,
  connectionNoProxy: string,
  vercelRelayUrl: string,
  strictProxy: boolean,
}

handleFetchCore({
  url,                 // string
  format,              // string | null | undefined
  maxCharacters,       // number | null | undefined
  provider,            // string
  providerConfig,      // object | undefined
  credentials,         // object | null | undefined
  signal,              // AbortSignal | undefined
  proxyOptions,        // FetchProxyOptions | null | undefined
  transport,           // ((url, init, proxyOptions) => Promise<Response>) | undefined
  log,                 // function | undefined
}) -> Promise<FetchResult>

validateOllamaRequest({ url, format, maxCharacters, providerConfig, credentials })
  -> { ok: true, url, format, maxCharacters, timeoutMs, apiKey }
   | { ok: false, result: FetchResult }

createOllamaDeadline({ callerSignal, timeoutMs })
  -> { signal, classify(error) -> { source, error }, clear() }

readBoundedBody(response, { maxBytes, signal, overflowMode })
  -> Promise<{ bytes: Uint8Array, overflowed: boolean }>

validateOllamaLinks(value)
  -> { ok: true, links: string[] } | { ok: false, result: FetchResult }

truncateUtf16Safely(text, maxCharacters) -> string

failure(status, code, message) -> FetchResult
validationFailure(status, code, message) -> { ok: false, result: FetchResult }
codedError(code) -> Error & { code: string }
sanitizeOllamaError(message, { apiKey, url }) -> string
ownCancellation(reader, reason) -> void
readWithSignal(reader, signal) -> Promise<{ value: Uint8Array, done: boolean }>
concatenateBytes(chunks, total) -> Uint8Array
isJsonMediaType(value) -> boolean
cancelResponseBody(response, reason) -> void
boundedUpstreamFailure(status, body, validatedRequest) -> FetchResult
parseAndNormalizeOllama(bytes, validatedRequest, startedAt, upstreamMs) -> FetchResult
classifyOllamaFailure(error, { deadline, apiKey, url }) -> FetchResult

runOllama({
  url, format, maxCharacters, providerConfig, credentials,
  signal, proxyOptions, transport, log, startedAt,
}) -> Promise<FetchResult>

// src/sse/handlers/fetch.js
buildFetchProxyOptions(credentials) -> {
  connectionProxyEnabled: boolean,
  connectionProxyUrl: string,
  connectionNoProxy: string,
  vercelRelayUrl: string,
  strictProxy: boolean,
}
```

`FetchResult.code` uses these stable adapter-local values. They describe transport observations, not fallback scope.

```js
const OLLAMA_ERROR = Object.freeze({
  INVALID_CONFIG: "OLLAMA_INVALID_CONFIG",
  INVALID_URL: "OLLAMA_INVALID_URL",
  INVALID_FORMAT: "OLLAMA_INVALID_FORMAT",
  INVALID_MAX_CHARACTERS: "OLLAMA_INVALID_MAX_CHARACTERS",
  INVALID_API_KEY: "OLLAMA_INVALID_API_KEY",
  CLIENT_ABORTED: "OLLAMA_CLIENT_ABORTED",
  TIMEOUT: "OLLAMA_TIMEOUT",
  TRANSPORT_ERROR: "OLLAMA_TRANSPORT_ERROR",
  RESPONSE_TOO_LARGE: "OLLAMA_RESPONSE_TOO_LARGE",
  INVALID_CONTENT_TYPE: "OLLAMA_INVALID_CONTENT_TYPE",
  INVALID_ENCODING: "OLLAMA_INVALID_ENCODING",
  INVALID_JSON: "OLLAMA_INVALID_JSON",
  EMPTY_RESPONSE: "OLLAMA_EMPTY_RESPONSE",
  INVALID_RESPONSE: "OLLAMA_INVALID_RESPONSE",
  UPSTREAM_ERROR: "OLLAMA_UPSTREAM_ERROR",
});
```

Status mapping is exact.

| Condition | Status |
|---|---:|
| Invalid local configuration | 500 |
| Invalid URL, format, or maximum | 400 |
| Missing or invalid Ollama key | 401 |
| Caller abort | 499 |
| Owned deadline | 504 |
| Transport, size, encoding, JSON, or response-shape failure | 502 |
| Ollama non-2xx response | Preserve the upstream status |

## Snapshot Stop Rule

The commit containing this plan is the implementation snapshot. At implementation start, verify that it is still `HEAD` and the worktree is clean.

```bash
task6_plan_head=$(git log -1 --format=%H -- docs/superpowers/plans/2026-08-30-ollama-cloud-web-fetch-transport.md)
test -n "$task6_plan_head"
test "$(git rev-parse HEAD)" = "$task6_plan_head"
test -z "$(git status --porcelain)"
```

Stop without stashing, resetting, or editing if any assertion fails. After each implementation commit, inspect the complete range from `task6_plan_head`. Stop if the changed paths include anything outside the three owned implementation paths or if the Ollama registry becomes publicly reachable.

## Task 1: Implement the bounded core adapter

**Files:**
- Modify: `open-sse/handlers/fetch/index.js:1-269`
- Create: `tests/unit/ollama-web-fetch-transport.test.js`

**Interfaces:**
- Consumes: `proxyAwareFetch(url, options, proxyOptions)` from `open-sse/utils/proxyFetch.js`; current `buildData`; Web `Response`, `Headers`, `ReadableStream`, `AbortSignal`, and `TextDecoder`.
- Produces: the `handleFetchCore` signature, private helpers, stable error codes, and normalized optional `links` shape defined above.
- Preserves: every non-Ollama branch and the current legacy default format, timeout, and maximum behavior for existing providers.

- [ ] **Step 1: Verify the snapshot and current unreachable state**

Run the Snapshot Stop Rule commands, then run:

```bash
node --input-type=module -e 'import("./open-sse/providers/registry/ollama.js").then(({ default: p }) => { if (p.serviceKinds?.includes("webFetch") || p.fetchConfig) throw new Error("Ollama web fetch is already public"); })'
git status --short --branch
```

Expected result is exit 0, a clean `integration/task6-pr3624` status, `serviceKinds: ["llm"]`, and no `fetchConfig`.

- [ ] **Step 2: Add deterministic test fixtures and the 39 request-contract tests**

Start `tests/unit/ollama-web-fetch-transport.test.js` with real core imports and an injected transport. Do not mock `proxyAwareFetch` for core tests.

```js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleFetchCore } from "../../open-sse/handlers/fetch/index.js";

const OLLAMA_CONFIG = Object.freeze({
  formats: ["markdown"],
  maxCharacters: 200000,
  timeoutMs: 30000,
  costPerQuery: null,
});

const TARGET = "https://example.com/article";
const API_KEY = "ollama_test_key";
const originalFetch = globalThis.fetch;

function successResponse(payload = { title: "Example", content: "Hello", links: [] }, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

function baseParams(overrides = {}) {
  const transport = overrides.transport || vi.fn().mockResolvedValue(successResponse());
  return {
    params: {
      url: TARGET,
      provider: "ollama",
      providerConfig: OLLAMA_CONFIG,
      credentials: { apiKey: API_KEY },
      proxyOptions: null,
      transport,
      ...overrides,
    },
    transport,
  };
}

async function runCore(overrides = {}) {
  const fixture = baseParams(overrides);
  return { result: await handleFetchCore(fixture.params), transport: fixture.transport };
}

beforeEach(() => {
  vi.useRealTimers();
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});
```

Create one `describe("Ollama web fetch request contract", ...)` block. Use `it.each` for the exact matrices below. Every invalid case asserts `success: false`, the exact status and code, `transport` call count 0, and no secret or target URL in `result.error`.

| Group | Count | Exact cases |
|---|---:|---|
| Official request and normalized success | 2 | Exact URL, method, headers, signal, proxy argument, and byte-exact body; empty links omitted and cost remains `null` |
| Configuration | 4 | Missing config; `formats: ["markdown", "text"]`; `maxCharacters: 100000`; `timeoutMs: 15000` |
| Credentials | 6 | Missing; empty; whitespace-only; non-ASCII; embedded whitespace or control; only legacy `key` or `token` present |
| Format | 8 | Omitted, `null`, and `markdown` accepted; `text`, `html`, `Markdown`, array, and number rejected |
| Maximum | 10 | Omitted, `null`, 1, and 200000 accepted; 0, -1, 1.5, `"5"`, `Infinity`, and 200001 rejected |
| URL | 7 | Missing; surrounding whitespace; malformed; `ftp:`; userinfo; exact 8192 UTF-8 bytes; 8193 UTF-8 bytes |
| Proxy forwarding | 2 | Exact five-field object passed unchanged; rejected strict transport invokes injected transport once and global fetch zero times |

Use this assertion for the official request test.

```js
expect(transport).toHaveBeenCalledWith(
  "https://ollama.com/api/web_fetch",
  expect.objectContaining({
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ url: TARGET }),
    signal: expect.any(AbortSignal),
  }),
  null,
);
expect(globalThis.fetch).not.toHaveBeenCalled();
```

- [ ] **Step 3: Run the request-contract group and record RED**

Run:

```bash
npm --prefix tests exec vitest -- run unit/ollama-web-fetch-transport.test.js -t "Ollama web fetch request contract"
```

Expected result is 39 failed tests. The primary failure is `Unsupported provider: ollama`, missing adapter-local codes, or a zero transport call. Stop if the new tests pass against the unmodified core.

- [ ] **Step 4: Add the 17 deadline and bounded-body tests before production edits**

Add these concrete stream helpers.

```js
function streamResponse(chunks, {
  status = 200,
  contentType = "application/json",
  contentLength,
  cancel = vi.fn(),
} = {}) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel,
  });
  const headers = new Headers({ "Content-Type": contentType });
  if (contentLength !== undefined) headers.set("Content-Length", String(contentLength));
  return { response: new Response(body, { status, headers }), cancel };
}

function hangingBodyResponse(cancel = vi.fn()) {
  return {
    response: new Response(new ReadableStream({ start() {}, cancel }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    cancel,
  };
}

function jsonBytesOfSize(totalBytes) {
  const prefix = '{"title":"","content":"';
  const suffix = '","links":[]}';
  const fill = totalBytes - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
  if (fill < 0) throw new RangeError("totalBytes is too small");
  return new TextEncoder().encode(prefix + "x".repeat(fill) + suffix);
}
```

Add `describe("Ollama web fetch deadline and bounded body", ...)` with exactly 17 tests.

| Group | Count | Exact cases |
|---|---:|---|
| Abort and deadline | 5 | Caller pre-abort; caller abort during body; 30000 ms slow headers; 30000 ms slow body; reader that never resolves |
| Body bounds and protocol | 12 | Exact 4 MiB; 4 MiB plus one byte; missing content length; understated content length; multibyte UTF-8; invalid UTF-8; invalid JSON; wrong content type; empty object; missing title; missing content; empty string content |

For fake-time tests, start the promise, attach the expectation before advancing time, call `await vi.advanceTimersByTimeAsync(30000)`, then await the result. Assert status 504, code `OLLAMA_TIMEOUT`, one reader cancellation when a reader exists, and `vi.getTimerCount() === 0`. Caller-abort cases assert status 499, code `OLLAMA_CLIENT_ABORTED`, preserved `signal.reason`, and no timeout classification.

- [ ] **Step 5: Run both unfinished groups and record cumulative RED**

Run:

```bash
npm --prefix tests exec vitest -- run unit/ollama-web-fetch-transport.test.js
```

Expected result is 56 failed tests. No production file has changed yet.

- [ ] **Step 6: Add the final 20 response, link, truncation, and error tests**

Add `describe("Ollama web fetch normalized response", ...)` with exactly 20 tests.

| Group | Count | Exact cases |
|---|---:|---|
| Links | 11 | Missing; empty; 100 valid; 101; exact 64 KiB aggregate; one byte over aggregate; non-string; non-HTTP scheme; embedded credentials; surrounding whitespace; order preserved with zero dereferences |
| Truncation | 4 | Default 200000; exact requested maximum; over requested maximum; high-surrogate boundary removes the unmatched high surrogate |
| Non-2xx and sanitization | 5 | Bounded JSON `error`; bounded text; oversized diagnostic body; API-key redaction; target-URL redaction |

The link boundary fixtures use ASCII URLs so `Buffer.byteLength` is exact. The 100-link and aggregate-boundary fixtures must assert the returned array preserves upstream order. The surrogate test uses `"A\uD83D\uDE00B"` with `maxCharacters: 2` and expects `"A"`, never `"A\uD83D"`.

For non-2xx JSON, assert the actual upstream status and `OLLAMA_UPSTREAM_ERROR`. For an error body over 16 KiB, assert the upstream status is preserved, the reader is canceled, and the message is exactly `Ollama web fetch failed (HTTP <status>)`.

- [ ] **Step 7: Run the full focused file and record the complete RED snapshot**

Run:

```bash
npm --prefix tests exec vitest -- run unit/ollama-web-fetch-transport.test.js
```

Expected result is 76 failed tests. Save the test summary in the implementation receipt. Do not edit production code unless the failures demonstrate missing Ollama behavior rather than test syntax or fixture errors.

- [ ] **Step 8: Add constants, failure sanitization, and request validation**

Import `proxyAwareFetch` and add private constants at the top of `open-sse/handlers/fetch/index.js`. Keep the existing Firecrawl defaults unchanged.

```js
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const OLLAMA_WEB_FETCH_URL = "https://ollama.com/api/web_fetch";
const OLLAMA_FORMAT = "markdown";
const OLLAMA_MAX_CHARACTERS = 200000;
const OLLAMA_TIMEOUT_MS = 30000;
const MAX_TARGET_URL_BYTES = 8192;
const MAX_SUCCESS_BODY_BYTES = 4 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 16 * 1024;
const MAX_ERROR_CHARACTERS = 512;
const MAX_LINKS = 100;
const MAX_LINK_BYTES = 8192;
const MAX_LINK_TOTAL_BYTES = 64 * 1024;
```

Implement `validateOllamaRequest` in this order so every invalid request makes zero network calls.

```js
function validateOllamaRequest({ url, format, maxCharacters, providerConfig, credentials }) {
  if (!providerConfig
      || providerConfig.formats?.length !== 1
      || providerConfig.formats[0] !== OLLAMA_FORMAT
      || providerConfig.maxCharacters !== OLLAMA_MAX_CHARACTERS
      || providerConfig.timeoutMs !== OLLAMA_TIMEOUT_MS) {
    return validationFailure(500, OLLAMA_ERROR.INVALID_CONFIG, "Ollama web fetch is not configured");
  }

  if (typeof url !== "string" || !url || url !== url.trim()
      || Buffer.byteLength(url, "utf8") > MAX_TARGET_URL_BYTES) {
    return validationFailure(400, OLLAMA_ERROR.INVALID_URL, "Invalid Ollama web fetch URL");
  }

  let parsed;
  try { parsed = new URL(url); } catch {
    return validationFailure(400, OLLAMA_ERROR.INVALID_URL, "Invalid Ollama web fetch URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    return validationFailure(400, OLLAMA_ERROR.INVALID_URL, "Invalid Ollama web fetch URL");
  }

  const resolvedFormat = format == null ? OLLAMA_FORMAT : format;
  if (resolvedFormat !== OLLAMA_FORMAT) {
    return validationFailure(400, OLLAMA_ERROR.INVALID_FORMAT, "Ollama web fetch supports markdown only");
  }

  const resolvedMax = maxCharacters == null ? OLLAMA_MAX_CHARACTERS : maxCharacters;
  if (!Number.isInteger(resolvedMax) || resolvedMax < 1 || resolvedMax > OLLAMA_MAX_CHARACTERS) {
    return validationFailure(400, OLLAMA_ERROR.INVALID_MAX_CHARACTERS, "max_characters must be an integer from 1 through 200000");
  }

  const apiKey = credentials?.apiKey;
  if (typeof apiKey !== "string" || apiKey !== apiKey.trim() || !/^[\x21-\x7E]+$/.test(apiKey)) {
    return validationFailure(401, OLLAMA_ERROR.INVALID_API_KEY, "A valid Ollama API key is required");
  }

  return { ok: true, url, format: resolvedFormat, maxCharacters: resolvedMax, timeoutMs: OLLAMA_TIMEOUT_MS, apiKey };
}
```

`failure(status, code, message)` clamps the final message to 512 characters. `sanitizeOllamaError(message, { apiKey, url })` replaces the exact key, the exact target URL, and Bearer-looking tokens before the clamp. Never pass the raw caught error to `log`.

```js
function failure(status, code, message) {
  return { success: false, status, code, error: String(message || "Ollama web fetch failed").slice(0, MAX_ERROR_CHARACTERS) };
}

function validationFailure(status, code, message) {
  return { ok: false, result: failure(status, code, message) };
}

function codedError(code, message = code) {
  return Object.assign(new Error(message), { code });
}

function sanitizeOllamaError(message, { apiKey, url }) {
  let safe = String(message || "Ollama web fetch failed");
  for (const secret of [apiKey, url]) {
    if (typeof secret === "string" && secret) safe = safe.split(secret).join("[redacted]");
  }
  safe = safe.replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]");
  return safe.slice(0, MAX_ERROR_CHARACTERS);
}
```

- [ ] **Step 9: Implement the total deadline and bounded stream reader**

`createOllamaDeadline` manually composes the optional caller signal and an owned timeout controller so Node runtimes without `AbortSignal.any` remain supported. Track the first source as `caller` or `timeout`, preserve `callerSignal.reason`, remove the caller listener in `clear()`, clear and optionally `unref()` the timer, and make `clear()` idempotent.

```js
function createOllamaDeadline({ callerSignal, timeoutMs }) {
  const controller = new AbortController();
  let source = null;
  let cleared = false;
  const abort = (nextSource, reason) => {
    if (source !== null) return;
    source = nextSource;
    controller.abort(reason);
  };
  const onCallerAbort = () => abort(
    "caller",
    callerSignal.reason ?? new DOMException("The operation was aborted", "AbortError"),
  );
  if (callerSignal?.aborted) onCallerAbort();
  else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

  const timer = setTimeout(() => abort(
    "timeout",
    codedError(OLLAMA_ERROR.TIMEOUT, "Ollama web fetch timed out"),
  ), timeoutMs);
  timer.unref?.();

  return {
    signal: controller.signal,
    classify(error) { return { source: source || "other", error: controller.signal.reason || error }; },
    clear() {
      if (cleared) return;
      cleared = true;
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    },
  };
}
```

Use one owned reader cancellation function and attach both resolve and reject handlers to every `reader.read()` promise.

```js
function ownCancellation(reader, reason) {
  try { Promise.resolve(reader?.cancel(reason)).catch(() => {}); } catch { }
}

function readWithSignal(reader, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, signal.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(reader.read()).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}
```

```js
async function readBoundedBody(response, { maxBytes, signal, overflowMode }) {
  const contentLength = response.headers.get("content-length");
  if (/^\d+$/.test(contentLength || "") && Number(contentLength) > maxBytes) {
    ownCancellation(response.body?.getReader(), new Error("response too large"));
    return overflowMode === "truncate"
      ? { bytes: new Uint8Array(), overflowed: true }
      : Promise.reject(codedError(OLLAMA_ERROR.RESPONSE_TOO_LARGE));
  }

  const reader = response.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(), overflowed: false };
  const chunks = [];
  let total = 0;
  let canceled = false;
  const cancel = (reason) => {
    if (canceled) return;
    canceled = true;
    ownCancellation(reader, reason);
  };
  try {
    while (true) {
      const { value, done } = await readWithSignal(reader, signal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        cancel(codedError(OLLAMA_ERROR.RESPONSE_TOO_LARGE));
        if (overflowMode === "truncate") return { bytes: new Uint8Array(), overflowed: true };
        throw codedError(OLLAMA_ERROR.RESPONSE_TOO_LARGE);
      }
      chunks.push(value);
    }
  } catch (error) {
    cancel(error);
    throw error;
  } finally {
    try { reader.releaseLock(); } catch { }
  }
  return { bytes: concatenateBytes(chunks, total), overflowed: false };
}
```

`ownCancellation` calls `reader.cancel(reason)` at most once and attaches `.catch(() => {})` to a returned promise. It must not await forever. `readWithSignal` rejects immediately when already aborted and otherwise races one read with one abort listener, removes the listener on either settlement, and owns the late resolution or rejection from the losing side.

- [ ] **Step 10: Implement successful response and link validation**

Decode with `new TextDecoder("utf-8", { fatal: true })`, then `JSON.parse`. Require a plain non-array object. Give `{}` the distinct `OLLAMA_EMPTY_RESPONSE` code. Require string `title` and string `content`; allow empty strings.

```js
function validateOllamaLinks(value) {
  if (value === undefined) return { ok: true, links: [] };
  if (!Array.isArray(value) || value.length > MAX_LINKS) {
    return validationFailure(502, OLLAMA_ERROR.INVALID_RESPONSE, "Invalid Ollama web fetch links");
  }
  let aggregateBytes = 0;
  for (const link of value) {
    if (typeof link !== "string" || link !== link.trim()) {
      return validationFailure(502, OLLAMA_ERROR.INVALID_RESPONSE, "Invalid Ollama web fetch links");
    }
    const bytes = Buffer.byteLength(link, "utf8");
    let parsed;
    try { parsed = new URL(link); } catch {
      return validationFailure(502, OLLAMA_ERROR.INVALID_RESPONSE, "Invalid Ollama web fetch links");
    }
    aggregateBytes += bytes;
    if (bytes > MAX_LINK_BYTES || aggregateBytes > MAX_LINK_TOTAL_BYTES
        || !["http:", "https:"].includes(parsed.protocol)
        || parsed.username || parsed.password) {
      return validationFailure(502, OLLAMA_ERROR.INVALID_RESPONSE, "Invalid Ollama web fetch links");
    }
  }
  return { ok: true, links: [...value] };
}
```

`truncateUtf16Safely` starts with `text.slice(0, maxCharacters)`. If the last retained code unit is a high surrogate, drop that code unit. Do not change the shared truncation behavior for existing providers.

Extend `buildData` with optional `links`; add `data.links` only when the validated array is non-empty. Existing providers continue to call it without links and preserve their byte shape.

`parseAndNormalizeOllama` follows this exact order.

```js
function parseAndNormalizeOllama(bytes, valid, startedAt, upstreamMs) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch {
    return failure(502, OLLAMA_ERROR.INVALID_ENCODING, "Ollama web fetch returned invalid UTF-8");
  }
  let data;
  try { data = JSON.parse(text); } catch {
    return failure(502, OLLAMA_ERROR.INVALID_JSON, "Ollama web fetch returned invalid JSON");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return failure(502, OLLAMA_ERROR.INVALID_RESPONSE, "Ollama web fetch returned an invalid response");
  }
  if (Object.keys(data).length === 0) {
    return failure(502, OLLAMA_ERROR.EMPTY_RESPONSE, "Ollama web fetch returned an empty response");
  }
  if (typeof data.title !== "string" || typeof data.content !== "string") {
    return failure(502, OLLAMA_ERROR.INVALID_RESPONSE, "Ollama web fetch returned an invalid response");
  }
  const checkedLinks = validateOllamaLinks(data.links);
  if (!checkedLinks.ok) return checkedLinks.result;
  return {
    success: true,
    data: buildData({
      provider: "ollama",
      url: valid.url,
      title: data.title,
      format: valid.format,
      text: truncateUtf16Safely(data.content, valid.maxCharacters),
      links: checkedLinks.links,
      costUsd: null,
      responseMs: Date.now() - startedAt,
      upstreamMs,
    }),
  };
}
```

- [ ] **Step 11: Wire `runOllama` and the dispatch branch**

In `handleFetchCore`, record `startedAt`, then dispatch `provider === "ollama"` before the current shared URL validation and before deriving legacy Firecrawl defaults. `runOllama` owns the Ollama URL result code. Pass raw `format` and `maxCharacters` so `null` and omission remain distinguishable. Default `transport` to `proxyAwareFetch` only inside the Ollama branch.

```js
async function runOllama(args) {
  const valid = validateOllamaRequest(args);
  if (!valid.ok) return valid.result;
  const deadline = createOllamaDeadline({ callerSignal: args.signal, timeoutMs: valid.timeoutMs });
  if (deadline.signal.aborted) {
    const classified = deadline.classify(deadline.signal.reason);
    deadline.clear();
    return classifyOllamaFailure(classified.error, { deadline, apiKey: valid.apiKey, url: valid.url });
  }
  let response;
  try {
    const upstreamStartedAt = Date.now();
    response = await args.transport(OLLAMA_WEB_FETCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${valid.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ url: valid.url }),
      signal: deadline.signal,
    }, args.proxyOptions ?? null);

    const upstreamMs = Date.now() - upstreamStartedAt;
    if (!response.ok) {
      const body = await readBoundedBody(response, {
        maxBytes: MAX_ERROR_BODY_BYTES,
        signal: deadline.signal,
        overflowMode: "truncate",
      });
      return boundedUpstreamFailure(response.status, body, valid);
    }

    if (!isJsonMediaType(response.headers.get("content-type"))) {
      cancelResponseBody(response, codedError(OLLAMA_ERROR.INVALID_CONTENT_TYPE));
      return failure(502, OLLAMA_ERROR.INVALID_CONTENT_TYPE, "Ollama web fetch returned a non-JSON response");
    }

    const body = await readBoundedBody(response, {
      maxBytes: MAX_SUCCESS_BODY_BYTES,
      signal: deadline.signal,
      overflowMode: "error",
    });
    return parseAndNormalizeOllama(body.bytes, valid, args.startedAt, upstreamMs);
  } catch (error) {
    return classifyOllamaFailure(error, { deadline, apiKey: valid.apiKey, url: valid.url });
  } finally {
    deadline.clear();
  }
}
```

`isJsonMediaType` accepts case-insensitive `application/json` and `application/*+json` before an optional semicolon. `boundedUpstreamFailure` extracts only scalar JSON `error`, `message`, or `detail`; otherwise it uses `Ollama web fetch failed (HTTP <status>)`. Oversized diagnostics always use the generic message. `classifyOllamaFailure` maps the first abort source before transport errors, then maps coded response failures, then returns redacted `OLLAMA_TRANSPORT_ERROR`.

```js
function concatenateBytes(chunks, total) {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function cancelResponseBody(response, reason) {
  try { ownCancellation(response.body?.getReader(), reason); } catch { }
}

function isJsonMediaType(value) {
  const mime = String(value || "").split(";", 1)[0].trim().toLowerCase();
  return mime === "application/json"
    || (mime.startsWith("application/") && mime.endsWith("+json"));
}

function boundedUpstreamFailure(status, body, valid) {
  const generic = `Ollama web fetch failed (HTTP ${status})`;
  let message = generic;
  if (!body.overflowed) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(body.bytes).trim();
      let parsed;
      try { parsed = JSON.parse(text); } catch { }
      const candidate = parsed?.error ?? parsed?.message ?? parsed?.detail;
      if (["string", "number", "boolean"].includes(typeof candidate)) message = String(candidate);
      else if (text && parsed === undefined) message = text;
    } catch { }
  }
  return failure(status, OLLAMA_ERROR.UPSTREAM_ERROR, sanitizeOllamaError(message, valid));
}

function classifyOllamaFailure(error, { deadline, apiKey, url }) {
  const classified = deadline.classify(error);
  if (classified.source === "caller") {
    return failure(499, OLLAMA_ERROR.CLIENT_ABORTED, "Ollama web fetch was canceled by the caller");
  }
  if (classified.source === "timeout") {
    return failure(504, OLLAMA_ERROR.TIMEOUT, "Ollama web fetch timed out");
  }
  if (classified.error?.code === OLLAMA_ERROR.RESPONSE_TOO_LARGE) {
    return failure(502, OLLAMA_ERROR.RESPONSE_TOO_LARGE, "Ollama web fetch response exceeded 4 MiB");
  }
  return failure(502, OLLAMA_ERROR.TRANSPORT_ERROR, sanitizeOllamaError(
    classified.error?.message || "Ollama web fetch transport failed",
    { apiKey, url },
  ));
}
```

Do not infer destination, auth, entitlement, quota, or fallback scope. Do not read `Retry-After`. Empty HTTP 200 `{}` remains a 502 `OLLAMA_EMPTY_RESPONSE` until the later state specification.

- [ ] **Step 12: Run all 76 core tests and record GREEN**

Run:

```bash
npm --prefix tests exec vitest -- run unit/ollama-web-fetch-transport.test.js
```

Expected result is exactly 1 passed file and 76 passed tests. Confirm no skips and `vi.getTimerCount() === 0` in every fake-timer test.

- [ ] **Step 13: Run core adjacency and static gates**

Run each command from the worktree root.

```bash
npm --prefix tests exec vitest -- run unit/firecrawl-selfhosted.test.js unit/jina-reader-fetch.test.js unit/strict-proxy-propagation.test.js unit/proxy-fetch-mitm-abort.test.js
node --check open-sse/handlers/fetch/index.js
npm exec eslint -- open-sse/handlers/fetch/index.js tests/unit/ollama-web-fetch-transport.test.js
git diff --check
git diff --stat
git diff --name-only
```

Expected changed paths are exactly `open-sse/handlers/fetch/index.js` and `tests/unit/ollama-web-fetch-transport.test.js`. Stop if an existing provider test changes its expected request or response behavior.

- [ ] **Step 14: Commit the bounded core adapter and verify advancement**

```bash
git add open-sse/handlers/fetch/index.js tests/unit/ollama-web-fetch-transport.test.js
git commit -m "feat(fetch): add bounded Ollama web transport"
git log --oneline -2
git show --check --stat --oneline HEAD
git status --short

task6_plan_head=$(git log -1 --format=%H -- docs/superpowers/plans/2026-08-30-ollama-cloud-web-fetch-transport.md)
task6_task1_paths=$(git diff --name-only "$task6_plan_head"..HEAD | LC_ALL=C sort)
task6_task1_expected=$(printf '%s\n' \
  open-sse/handlers/fetch/index.js \
  tests/unit/ollama-web-fetch-transport.test.js | LC_ALL=C sort)
test "$task6_task1_paths" = "$task6_task1_expected"
```

Expected result is one new logical commit, no hook rollback, and a clean worktree. The cumulative diff from the plan snapshot contains only the two Task 1 paths.

## Task 2: Pass caller signal and selected proxy policy

**Files:**
- Modify: `src/sse/handlers/fetch.js:1-220`
- Modify: `tests/unit/ollama-web-fetch-transport.test.js`

**Interfaces:**
- Consumes: `credentials.providerSpecificData` after `checkAndRefreshToken`, `request.signal`, and the Task 1 `handleFetchCore` signature.
- Produces: private `buildFetchProxyOptions(credentials)` with the exact five-field return type defined above.
- Preserves: provider resolution, combo expansion, inbound API-key checks, SSRF guard, credential selection, token refresh, success clearing, account fallback, CORS, and response serialization.

- [ ] **Step 1: Add two application-plumbing tests with isolated dynamic mocks**

Keep the real static core tests from Task 1. Put the two application tests under `describe("application signal and proxy plumbing", ...)`. Call `vi.resetModules()` and use `vi.doMock` before dynamically importing `@/sse/handlers/fetch.js`. Mock two private test providers so no Ollama registry change is needed.

```js
async function importFetchHandlerForPlumbing({ noAuth = false } = {}) {
  vi.resetModules();
  const mocks = {
    handleFetchCore: vi.fn().mockResolvedValue({
      success: true,
      data: { provider: "transport-fixture", content: { text: "ok" } },
    }),
    getProviderCredentials: vi.fn(),
    checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  };

  vi.doMock("@/shared/constants/providers.js", () => ({
    AI_PROVIDERS: {
      "transport-fixture": {
        id: "transport-fixture",
        noAuth,
        fetchConfig: { formats: ["markdown"], maxCharacters: 200000, timeoutMs: 30000 },
      },
    },
    resolveProviderId: (value) => value,
  }));
  vi.doMock("open-sse/handlers/fetch/index.js", () => ({ handleFetchCore: mocks.handleFetchCore }));
  vi.doMock("@/sse/services/auth.js", () => ({
    getProviderCredentials: mocks.getProviderCredentials,
    markAccountUnavailable: vi.fn(),
    clearAccountError: vi.fn(),
    extractApiKey: vi.fn(() => null),
    isValidApiKey: vi.fn(),
  }));
  vi.doMock("@/lib/localDb", () => ({
    getSettings: vi.fn(async () => ({ requireApiKey: false })),
    getCombos: vi.fn(async () => []),
  }));
  vi.doMock("@/sse/services/tokenRefresh.js", () => ({
    checkAndRefreshToken: mocks.checkAndRefreshToken,
    updateProviderCredentials: vi.fn(),
  }));
  vi.doMock("@/sse/utils/logger.js", () => ({
    request: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), maskKey: vi.fn(),
  }));
  vi.doMock("@/shared/utils/ssrfGuard.js", () => ({ assertPublicUrl: vi.fn() }));

  return { handleFetch: (await import("@/sse/handlers/fetch.js")).handleFetch, mocks };
}
```

The authenticated test returns credentials containing this exact resolved proxy state.

```js
const providerSpecificData = {
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:3128",
  connectionNoProxy: "localhost,127.0.0.1",
  connectionProxyPoolId: "pool-a",
  vercelRelayUrl: "https://relay.test/egress",
  strictProxy: true,
};
```

Set the authenticated fixture and request explicitly.

```js
const caller = new AbortController();
const { handleFetch, mocks } = await importFetchHandlerForPlumbing();
mocks.getProviderCredentials.mockResolvedValue({
  apiKey: API_KEY,
  connectionId: "connection-a",
  connectionName: "Ollama A",
  providerSpecificData,
});

const response = await handleFetch(new Request("http://localhost/v1/web/fetch", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ provider: "transport-fixture", url: TARGET }),
  signal: caller.signal,
}));

expect(response.status).toBe(200);
expect(mocks.handleFetchCore).toHaveBeenCalledWith(expect.objectContaining({
  signal: caller.signal,
  proxyOptions: {
    connectionProxyEnabled: true,
    connectionProxyUrl: "http://proxy.test:3128",
    connectionNoProxy: "localhost,127.0.0.1",
    vercelRelayUrl: "https://relay.test/egress",
    strictProxy: true,
  },
}));
expect(mocks.handleFetchCore.mock.calls[0][0]).not.toHaveProperty("transport");
expect(mocks.handleFetchCore.mock.calls[0][0].proxyOptions).not.toHaveProperty("connectionProxyPoolId");
expect(mocks.getProviderCredentials).toHaveBeenCalledWith("transport-fixture", expect.any(Set));
```

Create a `Request` with a caller controller signal, run `handleFetch`, and assert the response is 200. Assert `handleFetchCore` receives the identical signal and exactly these five transport fields, without `connectionProxyPoolId` and without a `transport` property. Assert `getProviderCredentials` keeps its current argument shape.

The no-auth test uses the mocked `noAuth: true` provider and asserts the identical caller signal plus this normalized empty policy.

```js
{
  connectionProxyEnabled: false,
  connectionProxyUrl: "",
  connectionNoProxy: "",
  vercelRelayUrl: "",
  strictProxy: false,
}
```

Use this exact no-auth test body.

```js
const caller = new AbortController();
const { handleFetch, mocks } = await importFetchHandlerForPlumbing({ noAuth: true });
const response = await handleFetch(new Request("http://localhost/v1/web/fetch", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ provider: "transport-fixture", url: TARGET }),
  signal: caller.signal,
}));

expect(response.status).toBe(200);
expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
const coreArgs = mocks.handleFetchCore.mock.calls[0][0];
expect(coreArgs.signal).toBe(caller.signal);
expect(coreArgs.proxyOptions).toEqual({
  connectionProxyEnabled: false,
  connectionProxyUrl: "",
  connectionNoProxy: "",
  vercelRelayUrl: "",
  strictProxy: false,
});
expect(coreArgs).not.toHaveProperty("transport");
```

After each dynamic test, call `vi.doUnmock` for every mocked specifier and `vi.resetModules()` so the 76 real-core tests remain isolated.

```js
const PLUMBING_MOCKS = [
  "@/shared/constants/providers.js",
  "open-sse/handlers/fetch/index.js",
  "@/sse/services/auth.js",
  "@/lib/localDb",
  "@/sse/services/tokenRefresh.js",
  "@/sse/utils/logger.js",
  "@/shared/utils/ssrfGuard.js",
];

afterEach(() => {
  for (const specifier of PLUMBING_MOCKS) vi.doUnmock(specifier);
  vi.resetModules();
});
```

- [ ] **Step 2: Run only the application-plumbing group and record RED**

Run:

```bash
npm --prefix tests exec vitest -- run unit/ollama-web-fetch-transport.test.js -t "application signal and proxy plumbing"
```

Expected result is exactly 2 failed tests. The `handleFetchCore` call currently lacks `signal` and `proxyOptions`. Stop if failure comes from mock collection, provider resolution, or request construction.

- [ ] **Step 3: Add the minimal private proxy-options builder**

Add this private helper near the imports in `src/sse/handlers/fetch.js`.

```js
function buildFetchProxyOptions(credentials) {
  const data = credentials?.providerSpecificData;
  return {
    connectionProxyEnabled: data?.connectionProxyEnabled === true,
    connectionProxyUrl: data?.connectionProxyUrl || "",
    connectionNoProxy: data?.connectionNoProxy || "",
    vercelRelayUrl: data?.vercelRelayUrl || "",
    strictProxy: data?.strictProxy === true,
  };
}
```

Do not export it and do not resolve proxy pools here. `getProviderCredentials` already returns the pool-resolved URL and identity.

- [ ] **Step 4: Pass signal and proxy options in both core calls**

Add these two properties to the no-auth `handleFetchCore` call.

```js
signal: request.signal,
proxyOptions: buildFetchProxyOptions(null),
```

Add these two properties to the authenticated call after token refresh.

```js
signal: request.signal,
proxyOptions: buildFetchProxyOptions(refreshedCredentials),
```

Do not pass a transport from the application module. Do not read `x-connection-id`, change `getProviderCredentials`, add a model key, or alter `markAccountUnavailable` and `clearAccountError`. Those belong to later subprojects.

- [ ] **Step 5: Run all 78 focused tests and record GREEN**

Run:

```bash
npm --prefix tests exec vitest -- run unit/ollama-web-fetch-transport.test.js
```

Expected result is exactly 1 passed file and 78 passed tests with no skips.

- [ ] **Step 6: Run application adjacency and static gates**

```bash
npm --prefix tests exec vitest -- run unit/fetch-success-clears-account.test.js unit/firecrawl-selfhosted.test.js unit/jina-reader-fetch.test.js unit/strict-proxy-propagation.test.js unit/proxy-fetch-mitm-abort.test.js
node --check open-sse/handlers/fetch/index.js
node --check src/sse/handlers/fetch.js
npm exec eslint -- open-sse/handlers/fetch/index.js src/sse/handlers/fetch.js tests/unit/ollama-web-fetch-transport.test.js
git diff --check
git diff --stat
git diff --name-only
```

The Task 2 working diff contains exactly `src/sse/handlers/fetch.js` and `tests/unit/ollama-web-fetch-transport.test.js`. The cumulative range from the plan snapshot contains exactly all three owned implementation paths.

- [ ] **Step 7: Commit the application plumbing and verify advancement**

```bash
git add src/sse/handlers/fetch.js tests/unit/ollama-web-fetch-transport.test.js
git commit -m "fix(fetch): pass request transport policy"
git log --oneline -3
git show --check --stat --oneline HEAD
git status --short

task6_plan_head=$(git log -1 --format=%H -- docs/superpowers/plans/2026-08-30-ollama-cloud-web-fetch-transport.md)
task6_task2_paths=$(git diff --name-only "$task6_plan_head"..HEAD | LC_ALL=C sort)
task6_task2_expected=$(printf '%s\n' \
  open-sse/handlers/fetch/index.js \
  src/sse/handlers/fetch.js \
  tests/unit/ollama-web-fetch-transport.test.js | LC_ALL=C sort)
test "$task6_task2_paths" = "$task6_task2_expected"
```

Expected result is a second new logical implementation commit, no hook rollback, and a clean worktree.

## Task 3: Verify the integrated Transport snapshot

**Files:**
- Modify: none
- Test: all owned and adjacent paths

**Interfaces:**
- Consumes: the two commits from Tasks 1 and 2.
- Produces: an evidence receipt only. This task must not create a commit or edit any file.

- [ ] **Step 1: Prove exact commit and path scope**

```bash
task6_plan_head=$(git log -1 --format=%H -- docs/superpowers/plans/2026-08-30-ollama-cloud-web-fetch-transport.md)
task6_commit_count=$(git rev-list --count "$task6_plan_head"..HEAD)
test "$task6_commit_count" -eq 2

task6_actual_paths=$(git diff --name-only "$task6_plan_head"..HEAD | LC_ALL=C sort)
task6_expected_paths=$(printf '%s\n' \
  open-sse/handlers/fetch/index.js \
  src/sse/handlers/fetch.js \
  tests/unit/ollama-web-fetch-transport.test.js | LC_ALL=C sort)
test "$task6_actual_paths" = "$task6_expected_paths"

git diff --check "$task6_plan_head"..HEAD
git log --oneline "$task6_plan_head"..HEAD
git status --short --branch
```

Expected result is exactly two implementation commits, exactly three changed paths, no whitespace errors, and a clean worktree. Stop on any extra path or commit.

- [ ] **Step 2: Prove Ollama remains unreachable from public web fetch**

```bash
node --input-type=module -e 'import("./open-sse/providers/registry/ollama.js").then(({ default: p }) => { if (p.serviceKinds?.includes("webFetch") || p.fetchConfig) throw new Error("Transport became publicly reachable"); })'
git diff --exit-code "$task6_plan_head"..HEAD -- \
  open-sse/providers/registry/ollama.js \
  src/app/api/v1/models/route.js \
  src/app/api/v1/models/info/route.js \
  src/sse/services/auth.js \
  src/shared/components
```

Expected result is exit 0 and no diff. Do not interpret direct `handleFetchCore({ provider: "ollama", ... })` test reachability as public route reachability.

- [ ] **Step 3: Run the focused and adjacency suites**

```bash
npm --prefix tests exec vitest -- run \
  unit/ollama-web-fetch-transport.test.js \
  unit/fetch-success-clears-account.test.js \
  unit/firecrawl-selfhosted.test.js \
  unit/jina-reader-fetch.test.js \
  unit/strict-proxy-propagation.test.js \
  unit/proxy-fetch-mitm-abort.test.js
```

Expected result is all selected files and tests passing. The focused file reports exactly 78 passed tests and no skips.

- [ ] **Step 4: Run the full JSON suite and verifier without masking either exit code**

Run this as one shell block from the worktree root.

```bash
task6_json_dir=$(mktemp -d)
task6_json="$task6_json_dir/results.json"
task6_vitest_rc=0
npm --prefix tests exec vitest -- run --reporter=json --outputFile="$task6_json" || task6_vitest_rc=$?
test -s "$task6_json"

task6_verifier_rc=0
node tests/__baseline__/verify-no-regression.mjs "$task6_json" || task6_verifier_rc=$?
printf 'vitest_exit=%s verifier_exit=%s report=%s\n' "$task6_vitest_rc" "$task6_verifier_rc" "$task6_json"
test "$task6_verifier_rc" -eq 0
```

The full Vitest exit may remain nonzero only for catalogued baseline failures. The verifier must exit 0. Preserve both values in the receipt. Missing JSON, a verifier error, or a new regression is not a pass.

- [ ] **Step 5: Run syntax, lint, isolated build, and final scope checks**

```bash
node --check open-sse/handlers/fetch/index.js
node --check src/sse/handlers/fetch.js
npm exec eslint -- open-sse/handlers/fetch/index.js src/sse/handlers/fetch.js tests/unit/ollama-web-fetch-transport.test.js
NEXT_TELEMETRY_DISABLED=1 npm run build
git diff --check "$task6_plan_head"..HEAD
git status --short --branch
git log --oneline -3
```

Expected result is successful syntax, lint, and build gates, a clean worktree, and verified log advancement. Do not start or deploy a runtime for this unreachable subproject.

- [ ] **Step 6: Stop at the Transport boundary**

Report the two implementation SHAs, RED and GREEN counts, focused and adjacency totals, full Vitest and verifier exit codes, build result, exact changed paths, and clean status. State explicitly that Ollama Cloud web fetch is not publicly available yet.

Do not continue into registry, discovery, model normalization, UI, account pinning, capability persistence, fallback classification, documentation, or skill changes. Those require the two later approved specifications named in the design.

## Design Coverage Map

| Approved Transport requirement | Owning plan steps |
|---|---|
| Official endpoint, method, Bearer key, headers, and exact body | Task 1 Steps 2, 8, 11, and 12 |
| Fail-closed configuration, URL, format, maximum, and API key | Task 1 Steps 2, 3, 8, and 12 |
| Per-connection proxy, relay, `NO_PROXY`, and `strictProxy` | Task 1 Steps 2 and 13; Task 2 Steps 1 through 6 |
| Caller abort and one 30000 ms total deadline | Task 1 Steps 4, 5, 9, 11, and 12 |
| 4 MiB success body and 16 KiB diagnostic body | Task 1 Steps 4, 5, 9, 11, and 12 |
| JSON media type, fatal UTF-8, object shape, empty-object code, and empty content | Task 1 Steps 4, 7, 10 through 12 |
| 100 links, 8192 bytes each, 64 KiB aggregate, safe schemes, no userinfo | Task 1 Steps 6, 7, 10, and 12 |
| UTF-16-compatible truncation without a dangling high surrogate | Task 1 Steps 6, 7, 10, and 12 |
| Bounded and redacted upstream errors without fallback classification | Task 1 Steps 6 through 12 |
| Existing fetch-provider compatibility | Task 1 Step 13; Task 2 Step 6; Task 3 Step 3 |
| Continued absence from registry and public discovery | Snapshot Stop Rule; Task 3 Steps 1, 2, and 6 |
| Full regression, syntax, lint, build, log, and clean-status evidence | Task 3 Steps 1 and 3 through 6 |

## Plan Integrity Receipt

- The plan has 3 tasks, of which 2 create implementation commits and 1 is verification-only.
- The implementation owns exactly 3 paths, with 0 registry, discovery, UI, auth-state, persistence, dependency, generated, or documentation implementation paths.
- The focused test inventory has exactly 78 tests, split into 76 core tests and 2 application-plumbing tests.
- Task 1 RED counts progress through 39, 56, and 76 failures before production edits.
- Task 2 has an independent 2-test RED before application code changes.
- Every private function and error code referenced by a later step is defined in this plan.
- Every test and verification command uses worktree-root paths. Vitest uses `npm --prefix tests exec vitest` without directory-state coupling.
- The full-suite shell preserves both the Vitest and verifier exit codes, so expected baseline failures cannot skip or mask the verifier.
- The snapshot rule rejects dirty state, extra commits, extra paths, public reachability, or changes to deferred subsystems.
- The plan contains no implementation placeholder and does not claim feature completion after Transport.
