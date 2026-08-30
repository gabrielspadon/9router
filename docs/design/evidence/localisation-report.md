# Localisation and right-to-left report

Measured by `docs/design/verification/audit-i18n.mjs` against the isolated
instance, driving four routes in five locales at 1280 by 800. Raw output is
`docs/design/evidence/i18n/i18n-audit.json`, with captures alongside it.

The locale genuinely switches. The harness was verified rather than assumed:
with the locale cookie set, the runtime fetches `/i18n/literals/<locale>.json`
and the navigation renders "Anbieter" in German, "提供商" in Chinese and
"ارائه‌دهندگان" in Persian.

## Length and density

| Locale | Case | Horizontal overflow | Truncated elements | Long nowrap labels |
|---|---|---|---|---|
| de | length stress | 0 | 1 to 5 | 2 to 3 |
| vi | length stress | 0 | 1 to 5 | 2 to 3 |
| zh-CN | density | 0 | 1 to 5 | 2 to 3 |
| ja | density | 0 | 1 to 5 | 2 to 3 |
| fa | right to left | 0 | 1 to 5 | 2 to 3 |

No locale produces horizontal overflow on any route measured, so no container
is sized to English. The truncation and nowrap counts are identical across all
five locales because the elements involved are structural rather than
linguistic: the install command in the rail, which is a shell command that must
not wrap, and identifier columns whose full value is present elsewhere on the
same screen. Truncating those is the permitted case in the design system.

## Right to left, the finding

**Persian, Arabic and Hebrew render in a left-to-right layout.** This is not a
regression introduced here; the application has never had right-to-left
support.

Evidence. The audit resolves `dir=ltr` for Persian on every route. The root
layout hardcodes `<html lang="en">` at `src/app/layout.js:35` with no `dir`
attribute, and the string `rtl` does not occur anywhere under `src/`, so no
component mirrors its layout.

Consequence. Persian, Arabic and Hebrew text is translated correctly but flows
against a layout whose rail, alignment and iconography all assume
left-to-right. Text renders right-to-left within each line because the browser
applies the Unicode bidirectional algorithm to the characters, while the
surrounding structure does not mirror.

Why it was not fixed here. The fix belongs in `src/app/layout.js`, which is
outside this work's writable surface, and it is behavioural rather than
presentational: `dir` has to be resolved from the locale cookie during the
server render. Setting it client-side would flash the wrong direction on first
paint.

Recommended owner and shape. The backend session. Read the existing locale
cookie in the root layout, set `lang` and `dir` on `<html>` from it, and add
the right-to-left locales to a single list. The presentation layer is already
compatible in the places it controls, because spacing uses logical properties
where Tailwind emits them; the remaining physical-direction utilities can be
migrated once `dir` is actually set, and are worth nothing before that.

This finding is also recorded in `docs/design/backend-handoff.md`.
