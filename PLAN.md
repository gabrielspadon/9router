# 9Router fork integration — plan and status log

## Goal
Independently maintained fork of decolua/9router: process upstream PR + issue backlog, repo professionalization, visual polish, all work in gabrielspadon/9router only. Upstream read-only (push URL disabled).

## Session log (append only)

### 2026-08-28 — session 1: bootstrap
- Remotes: origin fetch=decolua push=gabrielspadon; upstream remote added with push DISABLED_NO_PUSH_TO_UPSTREAM
- Upstream backlog at seed: 822 open PRs, 999 open issues (paginated via gh api)
- tracking/ seeded: upstream-prs-open.md (822), upstream-issues-open.md (999), closed files empty
- scripts/tracking/sync-upstream.mjs written: idempotent append, --check validator (overlap → exit 1, tested with seeded dupe PR #3604)
- Baseline: root npm install + tests npm install; vitest run = 90 failed / 1779 passed / 59 skipped, 17 expected-fail, 26 files failing (pre-existing on upstream master, 0 divergence from upstream/master)
- Fixed tests/__baseline__/verify-no-regression.mjs path bug (split on /app/ never matched locally → all paths undefined → gate could not detect anything)
- Regenerated known-fails.txt from clean master run: 90 entries; gate now reports ✅ No regression
- README.md: Fork Status section added
- Baseline recorded. PR backlog processing begins next session.

## Verification commands
- `node scripts/tracking/sync-upstream.mjs --check`
- `cd tests && npx vitest run --reporter=json --outputFile=/tmp/vitest-results.json` then `node __baseline__/verify-no-regression.mjs /tmp/vitest-results.json`
