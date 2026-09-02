# Docker

Running TokenProxy in a container. The image is built from the `Dockerfile` at
the repository root for `linux/amd64` and `linux/arm64`. No release tag has been
pushed yet, so no image exists on GHCR or Docker Hub to pull; build it locally
with `docker build -t tokenproxy .` until the first `v*` tag runs the publish
workflow described under [Publishing](#publishing).

The environment contract and where state lives are in `.env.example` and in
[CONTRIBUTING.md](CONTRIBUTING.md). Running it as a long-lived service outside a
container, behind a reverse proxy or under systemd, is in
[docs/deployment.md](docs/deployment.md). This page covers only what is specific
to the container.

## Quick start

```bash
docker run -d \
  -p 127.0.0.1:20128:20128 \
  -v "$HOME/.tokenproxy:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET='<set-a-strong-random-value>' \
  --name tokenproxy \
  tokenproxy:latest
```

The app listens on 20128 inside the container. Open http://localhost:20128,
which redirects to the dashboard. The first login uses `INITIAL_PASSWORD` and
falls back to `123456` when that is unset, so set it before publishing the port
on anything but loopback.

## Managing the container

```bash
docker logs -f tokenproxy        # follow logs
docker stop tokenproxy           # stop
docker start tokenproxy          # start again
docker rm -f tokenproxy          # remove
```

The image deliberately ships without npm, npx, yarn or corepack, because the
runtime only ever executes `node custom-server.js` and the bundled package
managers carry their own CVEs. A `docker exec` that expects a package manager
will not find one.

## Data persistence

```bash
-v "$HOME/.tokenproxy:/app/data" \
-e DATA_DIR=/app/data
```

`DATA_DIR` defaults to `/app/data` in the image, so the variable above is
belt-and-braces rather than strictly required, but keeping it explicit makes the
bind mount obvious. Without a mount, the data directory lives inside the
container and disappears with it.

Layout under `$DATA_DIR`:

```text
$DATA_DIR/
└── db/
    ├── data.sqlite       # main SQLite database
    └── backups/          # automatic backups
```

Host path `$HOME/.tokenproxy/db/data.sqlite` maps to container path
`/app/data/db/data.sqlite`.

`ENABLE_REQUEST_LOGS=true` does two separate things, and neither writes into
the mounted volume.

It turns on the per-request file logger in `open-sse/utils/requestLogger.js`,
called from `open-sse/handlers/chatCore.js`. That writes one folder per request
under a `logs/` directory resolved against the process working directory, which
is `/app` in the image, not `DATA_DIR`. Mount it explicitly if you want those
files to survive the container. Treat them as secret material: credential
headers are masked to a scheme plus the last four characters, but request and
response bodies are written as sent.

It is also the second-precedence override for request-detail recording into the
SQLite database behind `OBSERVABILITY_ENABLED`, which is what fills the Usage
"Details" tab. Same caveat on bodies. Leave the flag off in production unless
you are debugging.

The older `appendRequestLog()` in `src/lib/db/repos/usageRepo.js` is an empty
function; nothing writes a `log.txt` any more.

The image also creates `/app/data-home` and symlinks `/root/.tokenproxy` to it.
That path is a separate location from `/app/data` on purpose, so a home-directory
fallback never lands silently in the mounted volume. Mount `/app/data` and set
`DATA_DIR` to it, and the fallback is never used.

The entrypoint fixes ownership on `/app/data` and `/app/data-home` and then
drops to the unprivileged `node` user with `su-exec`, so a bind mount owned by
another uid on the host is corrected at start rather than failing at first
write.

## Environment variables

```bash
docker run -d \
  -p 127.0.0.1:20128:20128 \
  -v "$HOME/.tokenproxy:/app/data" \
  -e DATA_DIR=/app/data \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -e JWT_SECRET='<set-a-strong-random-value>' \
  -e INITIAL_PASSWORD=something-not-123456 \
  --name tokenproxy \
  tokenproxy:latest
```

`PORT`, `HOSTNAME`, `DATA_DIR`, `NODE_ENV=production` and
`NEXT_TELEMETRY_DISABLED=1` are already set in the image. The full list of
variables is in `.env.example`.
`JWT_SECRET` is required at startup and is neither generated nor written into
the mounted data directory.

`.env` is excluded from the build context by `.dockerignore`, so it is never
baked into the image. Inject configuration at run time with `-e` or
`--env-file`.

### Tuning the 429 backoff

When an upstream rate limit is detected, TokenProxy temporarily locks the affected
account and model with exponential backoff. The default schedule is 2s, 4s, 8s
and so on, capped at 5 minutes for up to 15 levels. Operators can tune it for
providers with different quota-reset windows:

```bash
-e BACKOFF_BASE_MS=2000 \
-e BACKOFF_MAX_MS=300000 \
-e BACKOFF_MAX_LEVEL=15
```

Each value is optional and must be a positive integer. A malformed value falls
back to that knob's own default, and a cap below the base is rejected as a
contradictory schedule, which restores the unchanged defaults. These settings
govern account and model locks after rate-limit fallback, not provider-specific
retry mechanisms and not a provider's own `Retry-After` hint.

## Compose

`docker-compose.yml` at the repository root brings up TokenProxy together with a
Headroom sidecar.

```bash
docker compose up -d
```

Three things differ from the `docker run` recipe above, and are worth knowing
before you use it.

State goes to a named volume called `tokenproxy-data`, not to a bind mount under
`$HOME/.tokenproxy`. Inspect it with `docker volume inspect tokenproxy-data`.

An `.env` file must exist beside the compose file, because the service declares
`env_file: .env` and compose fails when it is missing. Copy `.env.example` to
`.env` first.

The Headroom sidecar is not optional in that file. The `tokenproxy` service
declares `depends_on: headroom`, so compose starts both. Both published ports
are bound to `127.0.0.1`. TokenProxy reaches Headroom over the compose network at
`http://headroom:8787`, so the published Headroom port is only there for
host-side debugging and can be removed entirely without affecting routing.

### Development

`docker-compose.dev.yml` layers a hot-reload setup over the same base file, so a
source edit is picked up without rebuilding the image:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

It builds the `dev` target of the `Dockerfile` instead of pulling the published
image, tags it `tokenproxy-dev`, bind-mounts the repository at `/app` and runs
`next dev` on the same port 20128 as production, so the base file's port mapping
is reused unchanged. Two anonymous volumes shadow the bind mount at
`/app/node_modules` and `/app/.next`: the container's dependencies are built for
Alpine, and without those the container would either use the host's or write its
own build output back into the checkout as root.

The Node inspector is published on `127.0.0.1:9229`. Attach a debugger there.

Note that the dev container runs as root and skips the production entrypoint,
which is what makes a bind mount from an arbitrary host uid work. The Headroom
sidecar still starts, because the override changes only the `tokenproxy` service.

## Headroom sidecar

The TokenProxy image bundles neither Python nor Headroom. To use Headroom in
Docker, run it as a separate service and point TokenProxy at it:

```yaml
services:
  tokenproxy:
    image: tokenproxy:latest
    ports:
      - "127.0.0.1:20128:20128"
    volumes:
      - "$HOME/.tokenproxy:/app/data"
    environment:
      DATA_DIR: /app/data
      HEADROOM_URL: http://headroom:8787
    depends_on:
      - headroom

  headroom:
    image: ghcr.io/chopratejas/headroom:latest
```

In the dashboard, open Endpoint, then Token Saver, then Headroom, confirm the
URL reads `http://headroom:8787`, recheck the status, and enable it.

If Headroom runs on the Docker host instead of as a sidecar, use
`http://host.docker.internal:8787`. On Linux that hostname needs
`--add-host=host.docker.internal:host-gateway`, or the `extra_hosts` equivalent
in compose.

What Headroom actually does, and its timeout, circuit breaker and body-size
limits, are in the dashboard's Token Saver panel and in
`open-sse/rtk/`.

## Updating

```bash
docker pull tokenproxy:latest
docker rm -f tokenproxy
# re-run the quick start command
```

The database migrates itself on boot. Copy `$DATA_DIR` first if the upgrade
matters.

## CapRover

`captain-definition` at the repository root declares schema version 2 and points
at `./Dockerfile`, so a CapRover app deploys from the repository with no extra
configuration. Set the environment variables in the app settings and map a
persistent directory to the container's `/app/data`.

## Building the image locally

The `Dockerfile` is at the repository root and the build context is the
repository root.

```bash
docker build -t tokenproxy .

docker run --rm -p 127.0.0.1:20128:20128 \
  -v "$HOME/.tokenproxy:/app/data" \
  -e DATA_DIR=/app/data \
  tokenproxy
```

The base image is `node:22-alpine`, overridable for both build and runtime
stages through a build argument:

```bash
docker build --build-arg NODE_IMAGE=node:24-alpine -t tokenproxy .
```

The builder stage installs `python3`, `make`, `g++` and `linux-headers` so that
`better-sqlite3` can compile. That native module is an optional dependency, and
the runtime falls back through `node:sqlite` to the pure-JavaScript `sql.js`
when it is unavailable, so a build that fails to compile it still produces a
working image.

Beyond the Next.js standalone output, the runtime stage copies
`custom-server.js`, `open-sse/`, `src/mitm/`, and the `node-forge`, `next` and
`sql.js` packages. Next's file tracing follows JavaScript imports only, and each
of those is reached another way: the MITM helper is spawned as a separate
process, and `sql.js` loads `dist/sql-wasm.wasm` by path at run time, so tracing
alone would leave the last-resort database driver failing with `ENOENT`.

## Publishing

Publishing is automatic. Pushing a `v*` git tag runs
`.github/workflows/docker-publish.yml`, which builds `linux/amd64` and
`linux/arm64` and pushes to both GHCR and Docker Hub.

```bash
git tag v0.0.1
git push origin v0.0.1
```

The tag names are produced by `docker/metadata-action` with
`type=semver,pattern={{version}}`, so a `v0.0.1` git tag becomes image tag
`0.0.1` without the leading `v`, alongside `latest` under the workflow's
`is_default_branch` condition.

The GHCR image name is `ghcr.io/${{ github.repository }}`, so it follows
whichever repository ran the workflow. The Docker Hub name is `tokenproxy` and
pushing there needs the `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets to be
set on the repository. GHCR authentication uses the automatic `GITHUB_TOKEN`.
