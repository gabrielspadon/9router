# Deployment

9Router is a local tool by default. This page covers running it somewhere other
than your own laptop, what has to be set, and where its state lives.

Container specifics, including the published image, its volume layout and its
build, are in [DOCKER.md](../DOCKER.md). This page does not repeat them.

## Before exposing anything

The dashboard is an administrative surface with provider credentials behind it.
Four things matter before it is reachable from a network.

Set `INITIAL_PASSWORD` to something other than the `123456` fallback, and do it
before first boot, because the value is only consulted while no password hash
has been saved.

Set `JWT_SECRET` to a long random value. Without it a secret is generated and
stored at `$DATA_DIR/jwt-secret`, which is fine locally but means sessions break
whenever that file is not persisted.

Set `REQUIRE_API_KEY=true` so the `/v1/*` routes demand a bearer key. It
defaults to false, which is reasonable on loopback and not on the internet.

Set `AUTH_COOKIE_SECURE=true` when the instance sits behind an HTTPS reverse
proxy, so the session cookie carries the `Secure` attribute.

Two more are worth knowing. `custom-server.js` derives the client IP from the
TCP socket and strips an attacker-controlled `X-Forwarded-For`, trusting a
forwarding header only from a loopback reverse proxy. Never start a production
instance with a bare `next start`, which bypasses that wrapper. And
`ENABLE_REQUEST_LOGS` writes request and response bodies to disk unredacted, so
leave it off outside of debugging.

## Splitting the API off the dashboard

Setting `API_PORT` starts a second listener that serves only `/v1`, `/v1beta`,
`/responses` and `/codex`, and returns 404 for everything else, the dashboard
and its `/api/*` routes included. `API_HOSTNAME` defaults to `127.0.0.1`.

This is the supported way to publish the gateway through a tunnel, a mesh or a
zero-trust proxy without publishing the dashboard alongside it. Widen
`API_HOSTNAME` deliberately, never as a side effect.

## On a server, from source

```bash
git clone https://github.com/decolua/9router.git
cd 9router
npm install
npm run build
```

Then start the standalone build, which is the path that honours `PORT`:

```bash
DATA_DIR=/var/lib/9router \
JWT_SECRET=a-long-random-secret \
INITIAL_PASSWORD=something-not-123456 \
API_KEY_SECRET=another-long-random-secret \
MACHINE_ID_SALT=a-stable-salt \
NODE_ENV=production \
PORT=20128 \
HOSTNAME=0.0.0.0 \
BASE_URL=http://localhost:20128 \
node .next/standalone/custom-server.js
```

`npm run start` is not equivalent. It passes `--port 20127` on the command line,
which outranks `PORT` in the Next.js CLI, so it always serves on 20127 from a
source checkout.

Under a process manager, supervise that same command rather than the npm script:

```bash
npm install -g pm2
pm2 start .next/standalone/custom-server.js --name 9router
pm2 save
pm2 startup
```

Environment variables go in the pm2 ecosystem file or in the shell that starts
it. Rebuild and restart after pulling changes, because the standalone directory
is a build artefact.

## Behind a reverse proxy

Terminate TLS at the proxy, forward to the 9Router port on loopback, and set
`AUTH_COOKIE_SECURE=true`. The gateway streams Server-Sent Events, so response
buffering has to be off in the proxy or every answer arrives at once when the
stream closes. In nginx that is `proxy_buffering off;` on the location, plus a
`proxy_read_timeout` long enough for a slow model.

## On CapRover

`captain-definition` at the repository root declares schema version 2 and points
at `./Dockerfile`, so a CapRover app deploys straight from the repository with
no extra configuration. Set the environment variables in the CapRover app
settings and add a persistent directory mapped to the container's `/app/data`.

## Environment contract

`.env.example` is the authoritative list and carries the reasoning for each
value. The table below is the operational subset.

| Variable | Default | What it does |
| -- | -- | -- |
| `JWT_SECRET` | generated at `$DATA_DIR/jwt-secret` | Signs the dashboard session cookie |
| `INITIAL_PASSWORD` | `123456` | First login password, used only while no hash is saved |
| `DATA_DIR` | `~/.9router`, `%APPDATA%\9router` on Windows | Root of all persistent state |
| `PORT` | framework default | Listening port of the standalone server |
| `HOSTNAME` | framework default | Bind address, `0.0.0.0` in the container |
| `NODE_ENV` | runtime default | Set `production` for a deployment |
| `API_PORT` | unset | Starts an API-only second listener |
| `API_HOSTNAME` | `127.0.0.1` | Bind address of the API-only listener |
| `REQUIRE_API_KEY` | `false` | Enforces a bearer key on `/v1/*` |
| `AUTH_COOKIE_SECURE` | `false` | Marks the session cookie `Secure` |
| `API_KEY_SECRET` | `endpoint-proxy-api-key-secret` | HMAC secret for generated API keys |
| `MACHINE_ID_SALT` | `endpoint-proxy-salt` | Salt for the stable machine id hash |
| `DB_ENCRYPTION_KEY` | derived from the machine | Encrypts connection secrets at rest |
| `ENABLE_REQUEST_LOGS` | `false` | Writes request and response logs under `logs/` |
| `OBSERVABILITY_ENABLED` | `true` | Runtime observability signals |
| `BASE_URL` | `http://localhost:20128` | Server-side base URL used by cloud sync jobs |
| `CLOUD_URL` | `https://9router.com` | Server-side cloud sync endpoint |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:20128` | Public base URL, kept for compatibility |
| `NEXT_PUBLIC_CLOUD_URL` | `https://9router.com` | Public cloud URL, kept for compatibility |
| `BACKOFF_BASE_MS` | `2000` | First backoff step after a 429 |
| `BACKOFF_MAX_MS` | `300000` | Backoff ceiling |
| `BACKOFF_MAX_LEVEL` | `15` | Maximum number of backoff levels |
| `HEADROOM_URL` | `http://localhost:8787` | Optional external compression proxy |
| `HEADROOM_TIMEOUT_MS` | `30000` | Outbound compress timeout, 0 to 600000 exclusive |
| `HEADROOM_API_KEY` | unset | Bearer token sent outbound to the proxy |
| `HEADROOM_PROXY_TOKEN` | unset | Inbound secret for a proxy this app spawns |
| `FETCH_CONNECT_TIMEOUT_MS` | `60000` | Last-resort upstream response-header timeout |
| `OLLAMA_LOCAL_CONNECT_TIMEOUT_MS` | `120000` | Ollama Local first-token timeout |
| `SEARXNG_URL` | `http://localhost:8888/search` | Built-in unauthenticated web-search provider |
| `FIRECRAWL_BASE_URL` | `https://api.firecrawl.dev` | Firecrawl web fetch endpoint |
| `FIRECRAWL_API_KEY` | empty | Leave empty to route to a self-hosted Firecrawl |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` | empty | Outbound proxy for upstream calls |

Lowercase proxy variables work too. `INSTANCE_NAME` appears in older templates
and is not read at runtime.

`BASE_URL` and `CLOUD_URL` are preferred on the server side. The
`NEXT_PUBLIC_` pair is still honoured for compatibility and for the UI, but the
server runtime prioritises the non-prefixed pair. Cloud sync calls use a timeout
and fail fast, so unreachable cloud DNS degrades sync rather than hanging the
dashboard.

## Where state lives

| Path | Contents |
| -- | -- |
| `$DATA_DIR/db/data.sqlite` | Providers, connections, combos, aliases, keys, settings, pricing, usage history |
| `$DATA_DIR/db/backups/` | Automatic database backups |
| `$DATA_DIR/jwt-secret` | Generated session signing secret, when `JWT_SECRET` is unset |
| `./logs/` | Request and response logs, only when `ENABLE_REQUEST_LOGS=true` |

The data directory and the database file are created with restrictive
permissions on POSIX systems, 0700 for the directory and 0600 for the file,
because the database holds provider OAuth tokens and client API keys. Without
that they would inherit the process umask and be world-readable. Preserve those
permissions when backing the directory up.

The storage driver resolves through a fallback chain in `src/lib/db/driver.js`.
Under Bun it is `bun:sqlite`, then `sql.js`. Under Node it is `better-sqlite3`,
then `node:sqlite` on Node 22.5 or newer, then `sql.js`. `better-sqlite3` is an
optional dependency on purpose, so an install never fails on a machine without
build tools, and `sql.js` is a pure-JavaScript fallback that always works.
Journal mode is WAL.

Do not write to `data.sqlite` with an external tool while the server is running.
Stop the service, operate on the file, then start it again.

Legacy `db.json`, `usage.json`, `disabledModels.json` and `request-details.json`
in the data directory are imported once when a new database is first created,
and are not read afterwards.

## Backup and restore

Stop the service, copy the whole `$DATA_DIR` directory preserving permissions,
and start it again. Restoring on the same machine needs nothing else.

Restoring on a different machine needs `DB_ENCRYPTION_KEY` to have been set to a
fixed value before the connections were created, because the default encryption
key is derived from the machine. Without it the provider connections in the
restored database cannot be decrypted and have to be reconnected.

## Upgrading

From npm, `npm install -g 9router@latest` and restart. From source, pull, run
`npm install`, run `npm run build`, and restart the standalone server, since
`.next/standalone/` is a build artefact and a stale one will keep serving old
code. From the container image, see [DOCKER.md](../DOCKER.md).

Migrations run against the SQLite database on boot. Take the backup first.
