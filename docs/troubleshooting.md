# Troubleshooting

Symptoms first, in rough order of how often they come up.

## The dashboard is on a different port than expected

The npm launcher defaults to 20128. A source checkout does not.

`npm run dev` and `npm run start` both pass `--port 20127` on the command line,
and the Next.js CLI treats an explicit `--port` flag as higher precedence than
the `PORT` environment variable. So `PORT=20128 npm run dev` still serves on
20127, silently.

To pick the port from a source checkout, run the standalone build, which reads
`PORT`:

```bash
npm run build
PORT=20128 node .next/standalone/custom-server.js
```

In Docker the container sets `PORT=20128` and honours an override, because the
entrypoint reaches the standalone server rather than the npm scripts.

## First login is rejected

The password comes from `INITIAL_PASSWORD` and applies only while no password
hash has been saved. When the variable is unset the fallback is `123456`.

If a hash already exists, changing `INITIAL_PASSWORD` does nothing. Change the
password in the dashboard instead.

Being logged out on every restart usually means `JWT_SECRET` is unset in a
context where the generated secret at `$DATA_DIR/jwt-secret` is not persisted,
for example a container without a mounted data volume. Set `JWT_SECRET`
explicitly, or mount the volume.

## "Language model did not provide messages"

The provider answered without content, which in practice almost always means the
quota for that account is exhausted. Check the quota tracker in the dashboard
for the provider in question.

The fix is a combo with a fallback entry below the exhausted model, or switching
the primary to a cheaper tier. See [providers.md](providers.md).

## Rate limiting, or requests stalling after a burst

An upstream 429 locks that account and model pair with exponential backoff
rather than being retried immediately. The default schedule is 2s, 4s, 8s and so
on, capped at 5 minutes, for up to 15 levels.

Three variables tune it, each optional and each requiring a positive integer.
`BACKOFF_BASE_MS` defaults to 2000, `BACKOFF_MAX_MS` to 300000, and
`BACKOFF_MAX_LEVEL` to 15. A malformed value falls back to that knob's own
default, and a cap below the base is rejected as a contradictory schedule, which
restores the defaults for the whole schedule.

These govern account and model locks after rate-limit fallback. They are not
provider-specific retry logic and they do not override a provider's own
`Retry-After` hint.

## An OAuth connection stopped working

Tokens are refreshed automatically, both on the request path and by a background
sweep every 5 minutes that refreshes anything expiring within 30 minutes. A
connection that still fails has had its refresh token revoked upstream, which
reconnecting fixes. Open Providers, select the connection, and reconnect.

## An OAuth login never completes

Codex uses a fixed loopback callback port, 1455, because that is the port the
real Codex CLI registers with OpenAI. If another process holds 1455 the redirect
cannot land and the login hangs. Free the port and retry.

xAI performs endpoint discovery before the login begins, so the flow fails on a
machine with no outbound access to xAI.

GitHub Copilot and the AWS-based Kiro methods use a device code flow with no
callback listener, which is the flow to prefer on a locked-down network.

## Cursor import finds no token

The Cursor connection reads the token out of the Cursor IDE's own local database
rather than performing an OAuth login. Sign in to Cursor IDE at least once
first, otherwise the `cursorAuth/accessToken` key does not exist yet. Paths per
platform are in `src/lib/oauth/services/`.

## A self-hosted embedding server answers 501

The embedding adapter appends `/embeddings` to the configured base URL, so
`http://host:8080` becomes `http://host:8080/embeddings`, which is not the
OpenAI route, and llama-server answers 501.

Give it the OpenAI base with `/v1` included, `http://host:8080/v1`. A full
`.../v1/embeddings` is accepted too.

## A self-hosted connection is reported as a configuration error

Self-hosted Embedding has no cloud fallback by design. A connection saved with
no `baseUrl` is an error rather than a silent fall back to `api.openai.com`,
which would have sent your input text and API key to a third party under a
provider named "Self-hosted". Set the base URL on the connection.

Note also that the API key field must be non-empty even where the local server
ignores it, because that record is what carries `baseUrl`. Any placeholder
works.

## A working self-hosted embeddings endpoint is invisible in the dashboard

The Embedding page lists providers whose kind is embedding, plus provider nodes
of type `custom-embedding`. A node created as `openai-compatible`, the natural
choice when one endpoint serves both chat and embeddings, satisfies neither and
does not appear, even though routing through it works.

Use the first-class Self-hosted Embedding provider instead of a generic
OpenAI-compatible node.

## Claude Code does not list a model

Claude Code filters `/v1/models` with a case-insensitive `claude|anthropic`
substring match on the model id, and strips every field except `id` and
`display_name`. A model whose id contains neither word never appears in its
picker regardless of what the endpoint returned.

TokenProxy fronts non-Claude models behind a `claude-` prefix so they survive that
filter. Enable it on the Claude Compat page in the dashboard.

## OpenClaw cannot connect

Use `127.0.0.1` rather than `localhost` in the base URL. `localhost` can resolve
to IPv6 first, and the connection then fails against a server bound to IPv4.
OpenClaw also only reaches a TokenProxy on the same machine.

## Costs in the dashboard look enormous

The cost figure is an estimate of what the same traffic would have cost against
paid APIs directly. TokenProxy never charges anything and has no billing system.
Running free-tier models with a dashboard reading of several hundred dollars
means that is what you did not spend. See [providers.md](providers.md).

## The token savers appear to do nothing

Confirm the request is not carrying `X-TokenProxy-Token-Saver: off`, which disables
all of them. The comparison is case-insensitive against the literal `off`.

RTK skips a tool result below 500 bytes or above 10 MiB, skips anything marked
as an error, and discards its own output when the result is not smaller than the
input. On a workload of small tool results it can legitimately save nothing. It
logs a line only when at least one filter fired.

Headroom trips a circuit breaker after 2 consecutive failures and stays open for
30 seconds, and it refuses bodies above 256 KiB outright. PXPIPE only runs on the
Claude format, only above its character threshold, and reports `not_installed`
when the optional transform is absent.

The token savers themselves live in `open-sse/rtk/`.

## No request logs appear under `logs/`

Set `ENABLE_REQUEST_LOGS=true`. The directory is resolved relative to the
process working directory, not to `DATA_DIR`, so it appears wherever the server
was started from.

Treat these logs as secret material. Headers carrying credentials are masked to
a scheme plus the last four characters, but bodies are written unredacted, so
an enabled log folder persists provider tokens and client keys in plaintext for
as long as it survives. Leave it off in production.

## The database will not open after moving the data directory

Connection secrets are encrypted at rest with a key derived from the machine, so
a database copied to another machine cannot be decrypted there. Set
`DB_ENCRYPTION_KEY` to a fixed value, and set it before the connections are
created, if the data directory has to be portable.

## Where to look next

- [../CONTRIBUTING.md](../CONTRIBUTING.md) for install, local setup and the
  environment contract.
- [../open-sse/AGENTS.md](../open-sse/AGENTS.md) for the routing and
  translation engine's own conventions.
