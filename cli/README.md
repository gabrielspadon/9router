# TokenProxy

TokenProxy is a local AI routing gateway and dashboard. This package is its
launcher: it installs and starts the server, keeps it running in the system
tray, and updates it in place.

The gateway exposes one OpenAI-compatible endpoint, translates each request into
the format the chosen upstream expects, and falls back across models and
accounts, so a single client configuration keeps working when one provider runs
out of quota, rate limits you, or fails.

## Install and first request

```bash
npm install -g tokenproxy
tokenproxy
```

The dashboard opens at `http://localhost:20128/dashboard` and the
OpenAI-compatible API is at `http://localhost:20128/v1`. The first login uses
`INITIAL_PASSWORD`, which defaults to `123456` and should be overridden before
the instance is reachable by anything but loopback.

In the dashboard, connect a provider under Providers and copy a generated API
key. Then point any OpenAI-compatible client at the gateway:

```
Endpoint:  http://localhost:20128/v1
API key:   the key you copied from the dashboard
Model:     kr/claude-sonnet-4.5
```

A model is addressed as `providerPrefix/modelName`, and a combo is addressed by
its own name.

## What the gateway does

One endpoint fronts many upstreams. A request arriving in OpenAI, Claude,
Gemini, Cursor, Kiro, Ollama or OpenAI Responses shape is translated into
whatever the selected provider speaks, and the streamed response is translated
back.

Fallback happens at two levels. A combo is an ordered list of models, and the
next entry is tried when the current one is exhausted or errors. Within a single
provider, several accounts can be registered and are rotated the same way, so a
quota ceiling on one account is not a ceiling on the combo.

Token savers run before dispatch and are all fail-open. RTK rewrites bulky tool
results in place, Headroom and PXPIPE are optional external compressors, and
Caveman and Ponytail inject system prompts that shorten model output.

Any tool that speaks an OpenAI- or Claude-compatible API works, and the
dashboard writes the settings file directly for the coding agents it knows
about.

## Options

```bash
tokenproxy                    # start with default settings
tokenproxy -p 8080            # a different port
tokenproxy -H 127.0.0.1       # bind loopback only (the default is 0.0.0.0)
tokenproxy -n                 # do not open a browser
tokenproxy -l                 # show server logs instead of hiding them
tokenproxy -t                 # run in the system tray, in the background
tokenproxy --skip-update      # skip the auto-update check
tokenproxy stop               # stop the gateway running on the selected port
tokenproxy --help             # every option
```

### Memory limit

The server process starts with a 6 GB V8 heap cap. On a memory-limited host
(systemd `MemoryMax`, `docker --memory`, Kubernetes limits) lower it so the
garbage collector feels the limit before the kernel does:

```bash
TOKENPROXY_MAX_OLD_SPACE_SIZE=384 tokenproxy   # cap the heap at 384 MB
TOKENPROXY_MAX_OLD_SPACE_SIZE=0 tokenproxy     # no cap, let node size it
```

`NODE_OPTIONS=--max-old-space-size=…` is honoured too, and takes effect only
because TokenProxy stops passing its own default once you set one.

## Where state lives

- macOS and Linux: `~/.tokenproxy/db/data.sqlite`
- Windows: `%APPDATA%/tokenproxy/db/data.sqlite`
- Docker: `/app/data/db/data.sqlite`, with `$HOME/.tokenproxy` mounted to persist it

The database holds provider OAuth tokens and API keys, so it is created mode
0600 inside a 0700 directory.

## Documentation

Full documentation ships in the repository: `README.md` for the product,
`docs/deployment.md` for running it as a service, `DOCKER.md` for the container,
and `CONTRIBUTING.md` for building from source.

## Acknowledgments

- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI), the original Go
  implementation this JavaScript port was inspired by.

## License

MIT. See [LICENSE](LICENSE).
