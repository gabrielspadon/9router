#!/usr/bin/env bash
# Proves check-behaviour.mjs is worth trusting: a checker that never fails is
# not evidence. Five cases, each reverted immediately.
#
#   1 clean tree                  -> OK      (baseline)
#   2 source file renamed         -> OK      (a control may MOVE; that is the
#                                             whole point of the round-2 rule)
#   3 handler body altered        -> FAIL
#   4 fetch call removed          -> FAIL
#   5 read-only path edited       -> FAIL    (trespass)
set -uo pipefail
cd "$(dirname "$0")/../../.." || exit 2

CHECK="node docs/design/verification/check-behaviour.mjs"

if [ -n "$(git status --porcelain)" ]; then
  echo "refusing to run: working tree is dirty, revert would be ambiguous"
  git status --short | head
  exit 2
fi

restore() {
  git checkout -- . >/dev/null 2>&1
  git status --porcelain | grep -q . && { echo "RESTORE FAILED"; git status --short; }
}
trap restore EXIT

pass=0; fail=0
expect() { # expect <want ok|fail> <label>
  if $CHECK >/tmp/pbs.out 2>&1; then got=ok; else got=fail; fi
  if [ "$got" = "$1" ]; then pass=$((pass+1)); echo "  ok    $2 (got $got)"
  else fail=$((fail+1)); echo "  BAD   $2 (wanted $1, got $got)"; sed -n '1,6p' /tmp/pbs.out; fi
  git checkout -- . >/dev/null 2>&1
}

# A writable dashboard file carrying both a handler and a fetch call.
TARGET=$(git ls-files 'src/app/(dashboard)/**/*.js' 'src/shared/components/**/*.js' \
  | xargs grep -l 'fetch(' 2>/dev/null \
  | xargs grep -l 'on[A-Z][A-Za-z]*={' 2>/dev/null | head -1)
if [ -z "$TARGET" ]; then echo "no suitable target file found"; exit 2; fi
echo "target: $TARGET"

echo "1 clean tree"
expect ok "clean tree reports OK"

echo "2 rename a source file (a move must stay legal)"
MOVED="$(dirname "$TARGET")/__moved_probe.js"
git mv "$TARGET" "$MOVED" >/dev/null 2>&1 && expect ok "rename leaves the multiset unchanged"
git mv "$MOVED" "$TARGET" >/dev/null 2>&1
git checkout -- . >/dev/null 2>&1

echo "3 alter a handler body"
perl -0pi -e 's/(\bon[A-Z]\w*\s*=\s*\{)/$1 (void 0, /; s/(\bon[A-Z]\w*\s*=\s*\{ \(void 0, [^\n]*?)\}/$1)}/' "$TARGET" 2>/dev/null
if git diff --quiet -- "$TARGET"; then
  # perl left it untouched; fall back to a guaranteed handler mutation
  perl -0pi -e 's/onClick=\{/onClick={\/*probe*\/ /' "$TARGET"
fi
if git diff --quiet -- "$TARGET"; then echo "  skip  could not mutate a handler in $TARGET";
else expect fail "altered handler body is caught"; fi

echo "4 remove a fetch call"
perl -0pi -e 's/\bfetch\(/fetchDISABLED(/' "$TARGET"
expect fail "removed fetch call is caught"

echo "5 edit a read-only path"
RO=$(git ls-files 'src/lib/**/*.js' | head -1)
printf '\n// probe\n' >> "$RO"
expect fail "read-only trespass is caught"

echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ] && echo "SENSITIVITY OK"
[ "$fail" -eq 0 ]
