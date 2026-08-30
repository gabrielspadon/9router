# Translated README policy

One policy, so a reader knows what a translated page is worth and a contributor
knows what is expected of them.

## The English README is canonical

`README.md` is the source of truth. Every other README is a summary of it, not
a parallel document with its own content. Where a translated page and the
English page disagree, the English page is correct.

## Translations are summaries, deliberately

A translated page carries the one-sentence description, the install and first
request, and links onward. It does not carry the full capability summary, the
documentation index, or the acknowledgements. This is a maintenance decision
rather than neglect: ten full translations drift within weeks of any change,
and a confidently wrong translated page is worse for a reader than a short
accurate one that points at the canonical text.

## What a change to the English README requires

A change to the description sentence, the install commands, the first request,
or the default port must be reflected in every translated page in the same pull
request. A change anywhere else in `README.md` requires nothing of them.

The translated set is `README.zh-CN.md` and `i18n/README.*.md`.

## Adding a language

Copy the structure of an existing translated page, keep it to the sections
above, and add the link to the localised list in `README.md`. A new language is
accepted only with the commitment that its maintainer keeps the four load
bearing items above current; a page that falls behind on them is removed rather
than left to mislead.

## Verification

`docs/design/verification/check-i18n-policy.mjs` asserts this policy exists,
that the English README points at it, and that every translated page linked
from the English README is present and carries the install command and the
default port, which are the items most likely to go stale unnoticed.
