# 9Router

9Router is a local AI routing gateway and dashboard. It exposes one
OpenAI-compatible endpoint at `/v1/*`, translates each request into the format
the chosen upstream expects, and falls back across models and accounts, so a
single client configuration keeps working when one provider runs out of quota,
rate limits you, or fails.

<p align="center">
  <img src="./images/9router.png" alt="9Router dashboard" width="800"/>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/9router"><img src="https://img.shields.io/npm/v/9router.svg" alt="npm version"/></a>
  <a href="https://hub.docker.com/r/decolua/9router"><img src="https://img.shields.io/docker/v/decolua/9router?logo=docker&amp;label=docker" alt="Docker image version"/></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/9router.svg" alt="MIT license"/></a>
</p>

## Fork status

This repository is an **independently maintained fork** of
[decolua/9router](https://github.com/decolua/9router), tracking upstream while
carrying local fixes and integrations on its own schedule. The 9Router name, the
upstream history, the license and the author attribution are all preserved.

Upstream is a read-only reference and all development happens here. This fork is
not endorsed by the upstream project and does not speak for it. Open upstream
pull requests and issues are tracked under [`tracking/`](tracking/), where the
idempotent command `node scripts/tracking/sync-upstream.mjs` appends newly
discovered upstream items to the open queue. Test regressions are judged with
`node tests/__baseline__/verify-no-regression.mjs <results.json>` rather than
with a raw pass/fail run.

## Install and first request

Install the launcher from npm and start it.

```bash
npm install -g 9router
9router
```

The dashboard is served at `http://localhost:20128/dashboard` and the
OpenAI-compatible API at `http://localhost:20128/v1`. The first login uses
`INITIAL_PASSWORD`, which defaults to `123456` and should be overridden before
the instance is reachable by anything but loopback.

In the dashboard, connect one provider under Providers and copy a generated API
key. Then send a request.

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer YOUR_9ROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"kr/claude-sonnet-4.5","messages":[{"role":"user","content":"hello"}]}'
```

Any OpenAI-compatible client points at the same base URL and key. A model is
addressed as `providerPrefix/modelName`, and a combo is addressed by its own
name. Running from a source checkout, in Docker, or on a server is covered in
[docs/getting-started.md](docs/getting-started.md) and
[docs/deployment.md](docs/deployment.md).

## What it does

One endpoint fronts many upstreams. A request arriving in OpenAI, Claude,
Gemini, Cursor, Kiro, Ollama or OpenAI Responses shape is translated into
whatever the selected provider speaks, and the streamed response is translated
back, so a client that knows only one dialect can reach all of them. Binary and
protobuf upstreams that do not round-trip through the OpenAI shape are handled
inside their own executor instead.

Fallback happens at two levels. A combo is an ordered list of models, and the
next entry is tried when the current one is exhausted or errors. Within a single
provider, several accounts can be registered and are rotated the same way, so a
quota ceiling on one account is not a ceiling on the combo. Accounts hit by a
429 are locked with exponential backoff rather than retried immediately.

Credentials live in the dashboard. OAuth connections are refreshed in the
background before they expire, provider secrets are encrypted at rest in a local
SQLite database, and token usage, cost estimates and quota resets are tracked
per provider and per model.

Token savers run before the request is dispatched and are all fail-open, so any
error inside one leaves the request untouched. RTK rewrites bulky tool results
in place, Headroom and PXPIPE are optional external compressors, and Caveman and
Ponytail inject system prompts that shorten model output. Sending the header
`X-9Router-Token-Saver: off` bypasses every one of them for a single request.

Deployment is local by default. The same build runs from a source checkout, from
the published container image, or behind a reverse proxy on a server.

## Documentation

The index is [docs/README.md](docs/README.md). The pages a new user needs first:

- [Getting started](docs/getting-started.md) for installing, running from
  source, connecting a CLI tool, combos, and the API surface.
- [Providers](docs/providers.md) for what each upstream costs, how it is
  connected, and how self-hosted speech and embedding endpoints are wired.
- [OAuth](docs/oauth.md) for the browser login flows and how tokens are
  refreshed and stored.
- [Token saver](docs/token-saver.md) for how RTK, Headroom, PXPIPE, Caveman and
  Ponytail actually work and what each one costs you.
- [Troubleshooting](docs/troubleshooting.md) for the errors people hit most.
- [Deployment](docs/deployment.md) for servers, process managers, the
  environment contract, and where state is stored.
- [Architecture](docs/ARCHITECTURE.md) for the request lifecycle and the
  module map.

Container specifics live in [DOCKER.md](DOCKER.md).

## Localised summaries

These are short summaries only. This English page is canonical, and what a
translated page is expected to carry is written down in
[docs/design/translation-policy.md](docs/design/translation-policy.md).

[Português (Brasil)](./i18n/README.pt-BR.md) |
[Tiếng Việt](./i18n/README.vi.md) |
[中文](./README.zh-CN.md) |
[日本語](./i18n/README.ja-JP.md) |
[Русский](./i18n/README.ru.md) |
[ไทย](./i18n/README.th.md) |
[فارسی](./i18n/README.fa_IR.md) |
[Indonesia](./i18n/README.id-ID.md) |
[Español](./i18n/README.es.md) |
[Français](./i18n/README.fr.md)

## Acknowledgments

- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI), the original Go
  implementation this JavaScript port was inspired by.
- [RTK](https://github.com/rtk-ai/rtk), the Rust token saver whose compression
  pipeline is ported here.
- [Caveman](https://github.com/JuliusBrussee/caveman) by
  [@JuliusBrussee](https://github.com/JuliusBrussee), whose prompt is adapted
  for the output-terseness saver.
- [Ponytail](https://github.com/DietrichGebert/ponytail) by
  [@DietrichGebert](https://github.com/DietrichGebert), whose YAGNI ladder is
  adapted for the code-brevity saver.
- [Headroom](https://github.com/chopratejas/headroom), the optional external
  compression proxy.

## Support and license

Website [9router.com](https://9router.com). Questions, bug reports and feature
requests go through [SUPPORT.md](SUPPORT.md), which names the right channel for
each. Code changes start at [CONTRIBUTING.md](CONTRIBUTING.md). A vulnerability
goes through the private route in [SECURITY.md](SECURITY.md) and never through a
public issue.

MIT, see [LICENSE](LICENSE).
