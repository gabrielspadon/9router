# Token savers

9Router ships several independent ways to cut the number of tokens a request
costs. They are toggled per endpoint in the dashboard under Endpoint, they stack,
and every one of them is fail-open, meaning that any error inside a saver leaves
the request exactly as it arrived.

The engine lives in `open-sse/rtk/`. This page describes what is actually
implemented there, not a marketing summary of it.

## The pipeline, in order

Savers run inside `open-sse/handlers/chatCore.js` on the body that is about to be
dispatched to the provider executor. The order is fixed:

1. Progressive tool disclosure, which prunes the tool schema array.
2. RTK, which rewrites bulky tool results in place.
3. Headroom, an optional external compression proxy.
4. Caveman, which appends a terseness instruction to the system prompt.
5. Ponytail, which appends a brevity-of-code instruction to the system prompt.
6. PXPIPE, which renders bulky Claude-format context as images.
7. The memory optimiser, which prunes historical tool output across turns.

A single header disables all of them for one request:

```
X-9Router-Token-Saver: off
```

The check is a case-insensitive comparison against the literal `off`
(`TOKEN_SAVER_HEADER` in `open-sse/config/runtimeConfig.js`). Any other value,
including absence, leaves the savers enabled.

## RTK

RTK is a JavaScript port of the Rust [RTK](https://github.com/rtk-ai/rtk) token
saver. It rewrites the content of tool results, which for an agentic client is
usually the largest and least information-dense part of the prompt.

### Where it runs

RTK runs on the already-translated request body, after the client format has
been converted into the provider's format. It is not format-agnostic by running
before translation; it is format-aware, and `open-sse/rtk/index.js` recognises
the tool-result shape of each target format:

| Shape | Where the text lives |
| -- | -- |
| OpenAI tool message | `messages[].content` on a `role: "tool"` message, string or text parts |
| Claude block, string form | `content[].content` on a `type: "tool_result"` block |
| Claude block, array form | `content[].content[].text` on each text part |
| OpenAI Responses | `output` on a `type: "function_call_output"` item, string or `input_text` parts |
| Kiro | `conversationState.history[].userInputMessage.userInputMessageContext.toolResults[].content[].text` |

Anything it does not recognise is left untouched.

### What it skips

A tool result marked as an error is never compressed, because a truncated stack
trace is worse than an expensive one. That means `is_error: true` in the Claude
shape and `status: "error"` in the Kiro shape.

Size gates apply per blob. Anything below `MIN_COMPRESS_SIZE`, currently 500
bytes, is not worth a filter pass. Anything above `RAW_CAP`, currently 10 MiB, is
skipped rather than risking the CPU. Both constants are in
`open-sse/rtk/constants.js`.

### How a filter is chosen

`autoDetectFilter` peeks the first `DETECT_WINDOW` characters, currently 1024,
and matches in a fixed order so that an ambiguous blob lands on the more specific
filter. Build output is tested before the git porcelain heuristic precisely so
that a Cargo build's `Compiling foo` lines are not mistaken for `git status`.

The order is git-log, git-diff, git-status, build-output, grep, find, tree, ls,
search-list, read-numbered, dedup-log, smart-truncate, and then nothing.

There is no configuration. Nothing has to be declared by the client.

### The filters

| Filter | Input it recognises | What it does |
| -- | -- | -- |
| `git-log` | `commit <sha>` headers | Keeps headers, subjects, author and date; drops body padding, decoration and embedded diff lines |
| `git-diff` | `diff --git` or `@@` hunks | Keeps file headers and change counts, truncates each hunk at 100 lines |
| `git-status` | `On branch`, porcelain rows | Groups into staged, modified and untracked, capping each list |
| `build-output` | npm, yarn, cargo, maven, gradle chatter | Keeps errors, warnings and the final summary; drops progress and download lines |
| `grep` | `file:lineno:content` | Groups by file, caps matches per file |
| `find` | bare path lists | Groups by parent directory, shows basenames, caps per directory and total |
| `tree` | box-drawing glyphs | Drops the trailing summary line and caps total lines |
| `ls` | `ls -la` output | Compacts to name and size, drops known noise directories, summarises extensions |
| `search-list` | Cursor Glob result headers | Groups by directory like `find` |
| `read-numbered` | `  12\|content` file dumps | Keeps head and tail lines, drops the middle |
| `dedup-log` | generic repetitive output | Collapses consecutive duplicate lines and caps total lines |
| `smart-truncate` | a large blob with no structure | Keeps the first 120 and last 60 lines |

Two aliases exist for parity with the Rust original, `rg` for `grep` and `fd` for
`find`, in `open-sse/rtk/registry.js`.

### Compression is lossy, and bounded

The filters truncate. A hunk over 100 lines loses its tail, a directory with 40
matches shows 10, a 5000 line blob keeps 180 lines. This is the point: the tokens
that get cut are the ones carrying the least information. Do not describe this as
lossless.

Three guards keep it safe. `safeApply` in `open-sse/rtk/applyFilter.js` catches
anything a filter throws and returns the raw text, warning to stderr rather than
failing the request. A filter that returns a non-string is ignored. And a result
that is empty, or that is not smaller than the input, is discarded in favour of
the original, so RTK can never grow a request.

### Seeing what it saved

When at least one filter fires, a line is logged in the shape

```
[RTK] saved 19241B / 47102B (40.8%) via [git-diff,grep] hits=6
```

The percentage is bytes of tool-result text, not billed tokens. Provider-reported
usage on the request remains the ground truth for what was actually charged.

## Headroom

[Headroom](https://github.com/chopratejas/headroom) is a separate process that
exposes a `/v1/compress` endpoint. 9Router calls it, then continues with normal
routing, fallback, authentication and usage tracking.

```
client -> 9Router -> Headroom /v1/compress -> 9Router -> provider
```

The image 9Router ships does not bundle Python or Headroom. Running it locally:

```bash
pip install "headroom-ai[proxy]"
headroom proxy --port 8787
```

Enable it under Endpoint, Token Saver, Headroom. The default URL is
`http://localhost:8787`. In Docker, use the service name on a shared network,
`http://headroom:8787`, or `http://host.docker.internal:8787` when Headroom runs
on the host. On Linux that hostname needs `--add-host
host.docker.internal:host-gateway`, or the `extra_hosts` equivalent in compose.

Configuration is server-side only and is never exposed in the UI or in API
responses. `HEADROOM_URL` sets the endpoint. `HEADROOM_TIMEOUT_MS` sets the
outbound timeout and must be a finite integer above 0 and below 600000,
defaulting to 30000 when it is anything else. `HEADROOM_API_KEY` is sent
outbound as a bearer token. `HEADROOM_PROXY_TOKEN` is the inbound secret for a
proxy that 9Router spawns itself, and it is never sent outbound and never used
as a fallback for a missing `HEADROOM_API_KEY`. For managed-token authentication
set both to the same value.

Two protections are worth knowing about. Bodies above 256 KiB are not sent at
all, because measured compression time grows non-linearly with size and a large
body reliably exceeds the timeout while burning proxy CPU on a doomed request.
And a circuit breaker trips after 2 consecutive failures against an endpoint and
stays open for 30 seconds, so a dead proxy costs one timeout rather than one per
request.

If Headroom is down, slow, or returns an error, 9Router sends the original
request.

## Caveman

Caveman appends a terseness instruction to the system prompt so the model answers
in dense, technical shorthand rather than prose. It is adapted from
[Caveman](https://github.com/JuliusBrussee/caveman). The saving is on output
tokens, which for a chatty model is a large share of the bill.

Prompts are in `open-sse/rtk/cavemanPrompts.js` and the level is chosen in the
dashboard.

## Ponytail

Ponytail appends a "lazy senior developer" instruction, biasing the model toward
minimal, YAGNI-first code: deletion before addition, the standard library before
a new dependency, one line before an abstraction. It is adapted from
[Ponytail](https://github.com/DietrichGebert/ponytail).

Three levels are available. Lite builds what was asked and names the lazier
alternative. Full enforces the ladder of standard library, then native platform
feature, then an already-installed dependency, then one line, then minimal code.
Ultra puts deletion first and challenges the requirement in the same response.

Ponytail never trades away input validation, error handling that prevents data
loss, security, accessibility, or anything explicitly requested.

## How the prompt injectors work

Caveman and Ponytail share `open-sse/rtk/systemInject.js`, which dispatches on
the final request format so injection works for both translated and native
passthrough flows. The OpenAI family gets a system or developer message, or the
top-level `instructions` string on the Responses shape. Claude gets a `system`
string or block. Gemini, Vertex and Antigravity get `systemInstruction` parts,
and Antigravity's Gemini-shaped body nested under `request` is handled too.

Two details matter in practice. A dedup guard compares the first 100 characters
of the prompt against the existing system content, because a multi-turn
conversation replays the same injection on every request and appending blindly
would grow the system message without bound. And on the Claude shape the block is
inserted before the last `cache_control` marker, so the injection stays inside
the cached prefix rather than invalidating it.

## PXPIPE

PXPIPE renders bulky Claude-format context as dense PNG images, which are billed
by pixel count rather than by encoded length. The transformed body is larger in
bytes and cheaper in tokens.

It only runs on the Claude format, only when the serialised body exceeds a
threshold defaulting to 25000 characters, and only when the host has supplied the
transform function, so it reports `not_installed` rather than failing when the
optional dependency is absent. The transform is local CPU work that cannot be
aborted, so it is raced against a timer defaulting to 15 seconds and the result
is discarded if it loses. The input body is never mutated.

The before and after token figures PXPIPE reports are estimates. The after
figure is remaining text plus image tokens, not the character count of the new
body, because that would be nonsense for a body full of base64. Provider-billed
usage recorded per request stays the ground truth.

## Progressive tool disclosure

Tool schemas travel the prompt on every turn, so a client with many MCP tools
pays for all of them on every request. Disclosure runs before RTK and Headroom
and prunes that array, with a static filter phase and a BM25 selection phase.

The design and its reasoning are in
[design/progressive-tool-disclosure.md](design/progressive-tool-disclosure.md).

## Memory optimiser

The memory optimiser prunes historical tool output across turns rather than
within a single blob, keeping the last few tool turns in full and truncating
older ones. It targets long multi-turn agent sessions, where accumulated history
rather than any single result is the cost.

Its modules and defaults are documented in
[MEMORY_OPTIMIZATION.md](MEMORY_OPTIMIZATION.md).

## Choosing what to enable

RTK is the one to leave on. It costs nothing, needs no configuration, and it
only ever shrinks a request or leaves it alone.

Caveman and Ponytail change the model's behaviour, not just its input, so enable
them when you want terser answers and shorter diffs, and turn them off when you
want a full explanation.

Headroom and PXPIPE add a dependency and a latency cost. Enable them when you
have measured that RTK alone is not enough on your workload.
