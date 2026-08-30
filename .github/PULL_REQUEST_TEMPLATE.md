<!--
Open this pull request as a draft. Mark it ready for review once the branch is
settled and CI has reported. See CONTRIBUTING.md.
-->

## What changed

<!-- One paragraph. What a reviewer sees in the diff, in words. -->

## Why

<!--
The problem this solves, not the solution restated. Link the issue it closes
with "Closes #123". If there is no issue, say what prompted the change.
-->

## How it was verified

Tick only what you actually ran, and paste the output where it is short. An
unticked box is fine and honest; a ticked box that was not run costs a
reviewer's afternoon.

- [ ] `npx eslint .` is clean
- [ ] Focused tests for the change pass (`cd tests && npx vitest run <file>`)
- [ ] Baseline regression gate reports no regression

  ```
  cd tests && npx vitest run --testTimeout=30000 --hookTimeout=30000 \
    --reporter=default --reporter=json --outputFile.json=/tmp/9router-vitest.json
  cd .. && node tests/__baseline__/verify-no-regression.mjs /tmp/9router-vitest.json
  ```

  <!--
  The suite is not green on a plain checkout. This gate, not a raw pass count,
  is what says whether a passing test started failing. Paste its verdict line.
  -->

- [ ] Snapshot baselines pass, if this touched the provider registry, alias
      resolution or OAuth endpoints

  ```
  node tests/__baseline__/verify-providers.mjs
  node tests/__baseline__/verify-alias.mjs
  node tests/__baseline__/verify-oauth-urls.mjs
  ```

- [ ] Smoke tested on an isolated instance

  ```
  scripts/dev-test-server.sh up && node scripts/smoke-test.mjs && scripts/dev-test-server.sh down
  ```

- [ ] Verified by hand in the dashboard, for a UI change (say which pages, and
      in both themes if the change is visual)

<details>
<summary>Verification output</summary>

```
paste here
```

</details>

## Checks

- [ ] **No credential or token value appears anywhere in this diff.** No API
      key, OAuth access or refresh token, bearer header, session cookie,
      `JWT_SECRET`, `API_KEY_SECRET`, `MACHINE_ID_SALT`, `DB_ENCRYPTION_KEY`, or
      contents of a `DATA_DIR` database. Test fixtures use obvious placeholders.
- [ ] Commits follow Conventional Commits, imperative, one logical change each
- [ ] New configuration, if any, is documented in `.env.example`
- [ ] `CHANGELOG.md` gains an entry under Unreleased, appended without editing
      an existing one, for a user-visible change
- [ ] Behaviour that this changes for existing deployments is called out above

## Risk

<!--
What breaks if this is wrong, and who notices. Routing, credential handling and
translator changes affect live traffic; say which providers or client formats
are on the blast radius.
-->
