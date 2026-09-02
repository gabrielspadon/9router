# TokenProxy test suite

This directory is an independent ESM package with its own `package.json` and its
own dependency tree. It is not wired into the root `npm test`, so it needs the
root install first and then its own.

The canonical procedure, the baseline gate and the opt-in flags for live
provider tests are in [CONTRIBUTING.md](../CONTRIBUTING.md#tests). This page
covers only how the directory is laid out.

## Running

```bash
npm install              # repository root, first
cd tests && npm install  # then the suite's own dependencies
npx vitest run           # the whole suite
npx vitest run unit/capabilities.test.js   # one file, path relative to tests/
```

Run vitest from inside `tests/`. It discovers `tests/vitest.config.js`, which
resolves the `open-sse` and `@/` aliases back to the repository root, so the
suite works regardless of where the vitest binary lives.

The committed `test` script in `tests/package.json` hardcodes a shared
`NODE_PATH` inherited from upstream. Use the `npx vitest` form above instead.

## Layout

| Path | What lives there |
|---|---|
| `unit/` | The bulk of the suite. One file per behaviour, usually named after the issue it pins. |
| `translator/` | Format-translation round trips, one file per `source:target` pair. |
| `translator/real/` | Live provider calls. Gated behind `RUN_REAL=1`, and they cost money. |
| `auth/` | SAML single sign-on. |
| `e2e/` | Playwright browser specs, run by `playwright.config.js` there, not by vitest. |
| `fixtures/` | Recorded request and response bodies shared across tests. |
| `qa/` | The regression gate driven by `npm run qa:regression` from the root. |
| `__baseline__/` | Snapshot baselines and the verifiers that compare against them. |
| `smoke.mjs` | Root `npm run qa` / `qa:prod` entry point against a running instance. |

## The verdict is the baseline gate, not the red count

The suite is not expected to be green on a plain checkout. Judge a change with

```bash
npx vitest run --reporter=json --outputFile.json=/tmp/run.json
node __baseline__/verify-no-regression.mjs /tmp/run.json
```

which passes only when every failure in the run is already catalogued in
`__baseline__/known-fails.txt`. After touching the provider registry or alias
logic, also run `verify-providers.mjs`, `verify-alias.mjs` and
`verify-oauth-urls.mjs` from the same directory.

`unit/embeddings.cloud.test.js` fails here by design: it imports
`cloud/src/handlers/embeddings.js`, a worker directory that is not part of this
repository.
