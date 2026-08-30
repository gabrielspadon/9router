# Contributing

9Router is an OpenAI-compatible routing gateway with a Next.js dashboard. This
repository is `gabrielspadon/9router`, an independent fork of `decolua/9router`.
Contributions land here, not upstream.

Two authoritative documents already describe the system. Read
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before changing request handling,
and [`open-sse/AGENTS.md`](open-sse/AGENTS.md) before changing anything under
`open-sse/`. Both save re-deriving the design from the code.

## Repository layout

| Path | What lives there |
| --- | --- |
| `src/` | Next.js app, dashboard UI, dashboard and compatibility APIs |
| `open-sse/` | Provider-agnostic routing and translation engine |
| `cli/` | The `9router` npm launcher, a separate package with its own version |
| `gitbook/` | Documentation site, built and deployed on its own |
| `tests/` | Vitest suite, an independent ESM package |
| `scripts/` | Build, deploy and verification helpers |

## Local setup

```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

The dashboard serves at `/dashboard` and the gateway at `/v1`.

Run `npm install` at the repository root before anything else, including the
test suite, because the tests import from `src/` and `open-sse/`.

No lockfile is committed. `package-lock.json` is listed in `.gitignore`, so
`npm ci` cannot resolve a tree here and `npm install` is the install command
everywhere, including CI.

`better-sqlite3` sits in `optionalDependencies` on purpose. Install succeeds on
machines without build tools, and the SQLite layer falls back through
`node:sqlite` to the pure-JavaScript `sql.js` driver at runtime.

## Branching and pull requests

Branch off `master`. Open the pull request as a **draft** and mark it ready for
review only once the branch is settled. A draft signals that the branch is still
moving and keeps reviewers from spending attention on a moving target.

Batch your edits and push once per CI cycle. Every push starts a fresh run, and
a run started while another is in flight discards the earlier one.

A pull request is owned until it is green. If a check fails, fix it on the
branch rather than disabling the check.

## Commit messages

Conventional Commits, in the form `type(scope): subject`.

Types used in this repository are `fix`, `feat`, `docs`, `chore`, `test`,
`refactor`, `perf`, `ci`, `style`, `build` and `security`. Scopes are the area
touched, for example `translator`, `providers`, `claude`, `codex`, `usage`,
`auth`, `executors`, `cli`, `security`.

```
fix(translator): keep tool_result ids stable across the claude pivot
feat(providers): add Alibaba Token Plan for the Singapore region
docs: describe the baseline test gate
```

Write the subject in the imperative mood, 80 characters or fewer, describing
one logical change. Detail belongs in the body. A subject reading "fix X and
also Y" is two commits. Do not add trailers naming a tool or a co-author.

## Lint

```bash
npx eslint .
```

Must exit clean. The configuration is `eslint.config.mjs`, which extends
`eslint-config-next` core web vitals. Do not silence a rule to make a check
pass; fix the code or argue the rule change on its own merits in its own commit.

## Tests

`tests/` is an independent ESM package with its own `package.json` and its own
dependency tree. It is not wired into the root `npm test`, so it needs two
installs.

```bash
npm install              # repository root, first
cd tests && npm install  # then the suite's own dependencies
npx vitest run           # the whole suite
npx vitest run unit/capabilities.test.js   # one file, path relative to tests/
```

Run vitest from inside `tests/`. It discovers `tests/vitest.config.js`, which
resolves the `open-sse` and `@/` aliases back to the repository root, so the
suite works regardless of where the vitest binary lives.

Live provider tests under `tests/translator/real/` are gated behind `RUN_REAL=1`
and stay inert without it. Leave them inert unless you are deliberately testing
against real upstreams with your own credentials.

### The baseline gate

The suite is **not** expected to be green on a plain checkout. A set of failures
predates this fork and is catalogued in `tests/__baseline__/known-fails.txt`.
What matters for a change is whether it turns a passing test into a failing one.
That question is answered by the baseline gate, not by a raw pass count.

```bash
cd tests
npx vitest run --reporter=json --outputFile=/tmp/9router-vitest.json
cd ..
node tests/__baseline__/verify-no-regression.mjs /tmp/9router-vitest.json
```

The gate reads the vitest JSON report, subtracts the catalogued failures, and
exits 0 printing `No regression` when nothing else fails. It exits 1 and names
every offending test otherwise. Tests that are new, or that were already
failing, do not trip it.

Quote the command, not a number. Pass and fail counts move with every provider
addition and go stale in days.

Two limits are worth knowing. A test file that fails during **collection**, from
an import error or a missing environment variable, contributes no individual
test results at all, so its failure never reaches the gate. And the gate says
nothing about tests that were removed. Read the vitest summary alongside the
gate verdict.

### Snapshot baselines

Three further checks compare the live provider registry against committed
snapshots. Each takes no arguments and exits nonzero on any drift. Run them
after touching the provider registry, the alias logic, or OAuth endpoints.

```bash
node tests/__baseline__/verify-providers.mjs
node tests/__baseline__/verify-alias.mjs
node tests/__baseline__/verify-oauth-urls.mjs
```

## Verifying a change before it reaches a running instance

A running 9Router is frequently the upstream for the machine's own AI tooling,
so a broken build cuts the connection that would let you fix it. Verify on an
isolated instance first.

```bash
scripts/dev-test-server.sh up     # build, then start on :20129
node scripts/smoke-test.mjs       # exercise the running instance
scripts/dev-test-server.sh down   # stop it
```

`dev-test-server.sh up` runs `npm run build`, starts
`.next/standalone/custom-server.js` on port 20129 bound to `127.0.0.1` with
`DATA_DIR=/tmp/9router-test-data`, and polls `/dashboard` until it answers 200
or 30 seconds elapse, printing the log tail on failure. The separate `DATA_DIR`
means a fresh SQLite database with the default password, entirely apart from any
production instance and its stored credentials. `SKIP_BUILD=1` reuses an
existing `.next`.

`smoke-test.mjs` checks that the dashboard page loads, that dashboard login
returns a session cookie, that `/api/usage/statistics` returns its documented
shape, and that `/v1/models` answers 401 or 200 rather than hanging or 5xx. It
makes no upstream provider calls and costs nothing. Point it elsewhere with
`SMOKE_BASE`. It exits nonzero on any failed check.

## Adding a provider

Read `open-sse/AGENTS.md` first. In short, copy
`open-sse/providers/REGISTRY_TEMPLATE.js` into `open-sse/providers/registry/`,
add the models to `open-sse/config/providerModels.js`, and regenerate the
registry index with the scripts named in that document rather than hand-editing
it. Write an executor only for an upstream that is not OpenAI-compatible.

Translators self-register as an import side effect, so a new translator file
must be imported from `open-sse/translator/index.js` or it never runs. Never
hardcode a role, block or model string; the constants live in
`open-sse/translator/schema/` and `open-sse/config/`.

Open a [provider request issue](../../issues/new?template=provider_request.yml)
first if you want the upstream discussed before you write the code.

## Translations

The canonical README is the English `README.md`. It is the only file that
carries the full feature set, the provider list and the setup instructions.

`README.zh-CN.md` and the files under `i18n/` are short localised summaries.
Each states what 9Router is, gets a reader started, and links back to the
canonical [`README.md`](README.md) and to the documentation index at
[`docs/README.md`](docs/README.md) for everything else. They are deliberately
not full translations.

The reason is maintenance honesty. The front page moves with every provider
added, and a full translation of a moving page drifts within weeks into
confidently wrong instructions. One accurate English page plus ten honest
summaries that point at it beats ten stale copies.

When you change the README, update the localised summaries only if the change
touches what they actually say. Do not grow them back into full translations.
Adding a new locale means adding a summary of that same size, not a port of the
whole page.

## Code of conduct and security

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

Do not report a vulnerability in a public issue. The private disclosure route is
in [SECURITY.md](SECURITY.md).

Questions that are not bug reports belong in [SUPPORT.md](SUPPORT.md).
