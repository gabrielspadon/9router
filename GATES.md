# Session 1 gates — fork bootstrap

## upstream-read-only
- [x] CHECK: `git remote get-url --push upstream` EXPECT: `DISABLED_NO_PUSH_TO_UPSTREAM`
  EVIDENCE: `DISABLED_NO_PUSH_TO_UPSTREAM`
- [x] CHECK: `git remote get-url --push origin` EXPECT: gabrielspadon fork URL
  EVIDENCE: `https://github.com/gabrielspadon/9router.git`

## baseline
- [x] CHECK: `cd tests && npx vitest run` records pass/fail counts EXPECT: counts recorded in PLAN.md
  EVIDENCE: 90 failed / 1779 passed / 59 skipped, 26 files failed (pre-existing; see PLAN.md)

## sync-command
- [x] CHECK: `node scripts/tracking/sync-upstream.mjs --check` exits 0 on clean state EXPECT: exit 0
  EVIDENCE: exit 0, "tracking state OK"
- [x] CHECK: corrupt copy (ID in both open+closed) then `--check` exits nonzero EXPECT: nonzero + clear error
  EVIDENCE: exit 1, "PR #999999 appears in BOTH open and closed files"
- [x] CHECK: re-running sync appends nothing new EXPECT: 0 appended
  EVIDENCE: "appended 0 entries" on second run

## tracking-files
- [x] CHECK: `grep -c '^## PR #' tracking/upstream-prs-open.md` EXPECT: matches upstream open PR count
  EVIDENCE: 821 headings, matches upstream open PR count at seed time
- [x] CHECK: `grep -c '^## Issue #' tracking/upstream-issues-open.md` EXPECT: matches upstream open issue count (excl PRs)
  EVIDENCE: 1000 headings, matches upstream open issue count at seed time
- [x] CHECK: no ID duplicated within any open file EXPECT: duplicate count 0
  EVIDENCE: `sort | uniq -d` empty for both files

## fork-notice
- [x] README carries fork status section (independent fork, upstream relationship, no endorsement) EXPECT: section present
  EVIDENCE: README.md "Fork status" section; pushed commit 76850a417

## committed
- [x] CHECK: `git status --porcelain -- tracking scripts GATES.md PLAN.md README.md` EXPECT: clean after commit+push
  EVIDENCE: clean; commit 76850a417 pushed to origin/master
