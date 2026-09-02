# TokenProxy

TokenProxy is a local AI routing gateway and dashboard. It exposes one
OpenAI-compatible endpoint at `/v1/*`, translates each request into the format
the chosen upstream expects, and falls back across models and accounts, so a
single client configuration keeps working when one provider runs out of quota,
rate limits you, or fails.

## Install and first request

Install the launcher from npm and start it.

```bash
npm install -g tokenproxy
tokenproxy
```

The dashboard is served at `http://localhost:20128/dashboard` and the
OpenAI-compatible API at `http://localhost:20128/v1`. The first login uses
`INITIAL_PASSWORD`, which defaults to `123456` and should be overridden before
the instance is reachable by anything but loopback.

In the dashboard, connect one provider under Providers and copy a generated API
key. Put it in the environment rather than in the command, so it stays out of
your shell history.

```bash
export TOKENPROXY_KEY=...   # the key you copied from the dashboard

curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer $TOKENPROXY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"kr/claude-sonnet-4.5","messages":[{"role":"user","content":"hello"}]}'
```

Any OpenAI-compatible client points at the same base URL and key. A model is
addressed as `providerPrefix/modelName`, and a combo is addressed by its own
name. Running from a source checkout is covered in
[CONTRIBUTING.md](CONTRIBUTING.md); running in a container is covered in
[DOCKER.md](DOCKER.md).

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
`X-TokenProxy-Token-Saver: off` bypasses every one of them for a single request.

Deployment is local by default. The same build runs from a source checkout, from
the published container image, or behind a reverse proxy on a server.

## Documentation

- [Providers](docs/providers.md) for what each upstream costs, how it is
  connected, and how self-hosted speech and embedding endpoints are wired.
- [Troubleshooting](docs/troubleshooting.md) for the errors people hit most.
- [Deployment](docs/deployment.md) for running it as a service, what must be set
  before the port is reachable, and what a reverse proxy has to do.
- [Contributing](CONTRIBUTING.md) for the repository layout, local setup, the
  test suite, and the environment contract.
- [Docker](DOCKER.md) for the container, compose, and the image build.
- [Agent skills](public/skills/README.md) for the bundled skill bundles the
  dashboard serves to coding agents.
- [Security](SECURITY.md) for the private disclosure route.

The routing and translation engine documents its own conventions in
[open-sse/AGENTS.md](open-sse/AGENTS.md); read it before changing anything
under `open-sse/`.

TokenProxy ships in English only.


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

Bug reports and feature requests go through the repository's issue tracker.
Code changes start at [CONTRIBUTING.md](CONTRIBUTING.md). A vulnerability
goes through the private route in [SECURITY.md](SECURITY.md) and never through a
public issue.

TokenProxy contacts your providers because that is the product. Everything else it
can reach on its own, and how to turn each one off, is listed under
[what talks to the network](SECURITY.md#what-talks-to-the-network-besides-your-providers).
Dashboard analytics is off by default and no prompt, response or credential is
sent anywhere but the provider you routed to.

MIT, see [LICENSE](LICENSE).
