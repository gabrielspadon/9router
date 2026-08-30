# README language policy

One policy, so a reader knows which page is authoritative and a contributor
knows what a pull request adding a language is signing up for.

## English is the only shipped README

`README.md` is the single front door. This fork ships no translated README.

Upstream carried ten of them. They were removed here rather than kept, because
a translated page that has fallen behind is worse for a reader than no page at
all: it states an install command, a default port or a capability that the
English page has already corrected, and the reader has no way to tell. Ten
pages drift within weeks of any change to the four items below, and this fork
integrates upstream changes continuously.

## The four load bearing items

A translated page, if one ever ships, is a summary rather than a parallel
document. It carries the one-sentence description, the install command, the
first request, and the default port, then links onward to the English page for
everything else. Those four items are what a stale translation gets wrong in a
way that costs the reader real time.

## What accepting a language would require

A pull request adding a language is accepted only with all of the following.

- The page is linked from `README.md`, so the verification below can see it.
- The page carries `npm install -g 9router` and the default port `20128`
  verbatim, so a drift in either is mechanically detectable.
- A named maintainer commits to updating it in the same pull request as any
  change to the four load bearing items. A page that falls behind is removed
  rather than left to mislead.

Until a language meets that bar, the honest answer to a reader is the English
page rather than a stale translation of it.

## Verification

`docs/design/verification/check-i18n-policy.mjs` asserts that this policy
exists, that `README.md` points at it, and that every translated page the
English README links is present and carries the install command and the default
port. With no translated page linked, the checker asserts that none is present
in the shipped tree either, so the policy and the repository cannot disagree
silently.
