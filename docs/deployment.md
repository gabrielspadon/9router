# Deployment

Running TokenProxy as a long-lived service on a machine other than your laptop.
The container path is in [DOCKER.md](../DOCKER.md); this page covers a bare
process behind a service manager, what has to be set before it is reachable, and
what to check afterwards.

## Before it is reachable

Three settings decide whether the instance is safe to expose. None of them has a
usable default.

`JWT_SECRET` signs the dashboard session cookie and is checked at startup in
`custom-server.js`. Without it the process refuses to start and says so on fd 2,
which is where `docker logs` and `journalctl` read. Set it to 32 or more
characters of randomness (`openssl rand -hex 32`), keep it out of the data
directory, and keep it stable: changing it invalidates every existing session.

`INITIAL_PASSWORD` seeds the first dashboard login and defaults to `123456`. It
is only consulted while no password has been set, so overriding it matters at
first boot and never again. On a remote deployment it is effectively required:
a non-loopback login against the untouched default is refused with 403 and no
session cookie, and there is no remote self-service way out of that state,
because the change-password route needs the cookie it just withheld. Set it
before first launch, or take the first login from the machine itself.

`DATA_DIR` decides where the SQLite database, its backups and the derived
secrets live. It holds provider OAuth refresh tokens and plaintext client API
keys, so the directory is created mode 0700 and its files 0600, and permissions
are re-tightened on every start. Never start the process once under `sudo`:
that leaves root-owned files, and every later start as the service user fails on
the first read.

`API_KEY_SECRET` and `MACHINE_ID_SALT` should also be set explicitly rather than
derived, so the database stays readable if the host changes. `DB_ENCRYPTION_KEY`
does the same for provider secrets at rest and is what makes a `DATA_DIR` move
between machines survivable.

The complete list of variables, with the optional ones, is `.env.example`.

## Ports

The dashboard and the OpenAI-compatible API share port 20128 by default. `PORT`
moves both; `HOSTNAME` decides the bind address, and `0.0.0.0` is the deliberate
choice to leave loopback.

Set `API_PORT` to put the gateway on a second listener that serves only `/v1`,
`/v1beta`, `/responses` and `/codex`. Everything else 404s there, including the
dashboard and its `/api/*` routes. That is the shape to use when the API has to
be reachable through a tunnel, a mesh or a Zero Trust proxy while the dashboard
stays private. `API_HOSTNAME` defaults to `127.0.0.1`, so widening it is always
an explicit act.

## Behind a reverse proxy

`custom-server.js` derives the client address from the TCP socket and deletes
every client-supplied forwarding header before the request reaches the app.
`X-Forwarded-For` and `X-Real-IP` are honoured only when the TCP peer is itself
loopback, which is the reverse-proxy case; a request arriving directly from a
public socket is keyed by its unspoofable peer address no matter what headers it
carries. Rate limiting and per-IP accounting depend on that, so terminate TLS on
the same host and proxy to `127.0.0.1`, rather than pointing a remote proxy at a
publicly bound port.

Set `AUTH_COOKIE_SECURE=true` once the dashboard is served over HTTPS, and set
`BASE_URL` and `NEXT_PUBLIC_BASE_URL` to the externally visible origin so OAuth
callbacks and the internal sync job address the instance the way a browser does.

The gateway streams. Disable response buffering on the proxy for `/v1`
(`proxy_buffering off` in nginx) or the first token arrives only when the whole
response does.

## Running it under a service manager

Every launcher, the image's `CMD`, the CLI, pm2 and `npm start`, ends at
`node custom-server.js`. A systemd unit is the smallest way to get restarts and
logs:

```ini
[Unit]
Description=TokenProxy
After=network-online.target

[Service]
Type=simple
User=tokenproxy
WorkingDirectory=/opt/tokenproxy
EnvironmentFile=/etc/tokenproxy.env
ExecStart=/usr/bin/node custom-server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`EnvironmentFile` keeps the secrets out of the unit and out of `ps`. Node's heap
cap matters on a memory-limited host: the CLI launcher starts the server with a
6 GB cap, so under `MemoryMax` lower it with
`TOKENPROXY_MAX_OLD_SPACE_SIZE` or `NODE_OPTIONS=--max-old-space-size=…` and let
the garbage collector feel the ceiling before the kernel does.

The npm launcher can supervise itself instead. `tokenproxy --tray` runs in the
background, and `tokenproxy stop` stops the listener on the selected port. On a
headless Linux box the autostart path writes a `systemd --user` unit rather than
an inert desktop entry.

## State and backups

Everything the instance owns lives under `DATA_DIR`:

```text
$DATA_DIR/
└── db/
    ├── data.sqlite       # main SQLite database
    └── backups/          # pre-migration safety copies
```

A backup is taken before a schema migration, not on a schedule, and the newest
three are kept. The `requestDetails` observability table is excluded so the copy
stays a few megabytes against a database that may be hundreds. There is no
automated restore: recovery is copying a backup file back with the service
stopped.

Stop the service before touching the database by hand. SQLite runs in WAL mode
and writing to it from a second process while the server is live is how the file
gets corrupted.

## Verifying before it goes live

A running TokenProxy is frequently the upstream for the machine's own AI
tooling, so a broken deploy cuts the connection you would use to fix it. Build
and smoke-test on an isolated instance first:

```bash
scripts/dev-test-server.sh up     # build, start on :20129, DATA_DIR=/tmp/tokenproxy-test-data
node scripts/smoke-test.mjs       # dashboard, login, statistics shape, gateway liveness
scripts/dev-test-server.sh down
```

That instance has its own database and default password and never reads the
production credentials. `SKIP_BUILD=1` reuses an existing `.next`. The procedure
is described in full in [CONTRIBUTING.md](../CONTRIBUTING.md).

After a real deploy, check `/api/health` for the process, then open the
dashboard: the gateway keeps answering `/v1` even when the dashboard half is
broken, which is why a healthy port is not by itself evidence that the install
works.

## Upgrading

Replace the build, restart, and let migrations run at boot. They take their own
backup first. Nothing in the upgrade path rewrites `DATA_DIR`, so a rollback is
restoring the previous build against the same directory, with the caveat that a
migration already applied is not reversed.
