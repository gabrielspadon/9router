# Backend-dependent findings, routed to the backend session

The redesign is bound by a behavioural contract: no request, endpoint, state,
hook call site or handler may be added, removed or altered. The repository-wide
fingerprint in `docs/design/verification/check-behaviour.mjs` enforces it.

Several improvements the design calls for cannot be made under that contract
because the data they need is not in scope where the design needs it. Each is
recorded here with the file, the line, the reason and the recommended owner,
rather than worked around in the presentation layer.

Nothing in this list has been implemented. The presentation work shipped
alongside it is built from data that already exists where it is rendered.

---

## 1. The system-state masthead cannot show live telemetry

**Files.** `src/shared/components/layouts/DashboardLayout.js:36-39`,
`src/shared/components/Sidebar.js:82`, `src/shared/components/Header.js:184-198`.

**What the design needs.** A masthead persistent on every dashboard route
carrying throughput, p95 latency, error rate, failover rate and spend, so the
five-second question "is the system healthy" is answered before the eye reaches
the content. This is signature element 1 in `docs/design/direction.md`.

**Why it cannot be built.** The only state in shell scope is the notification
list (`DashboardLayout.js:38`), connectivity (`Sidebar.js:82`), version and
update availability (`Sidebar.js:110`), and the authenticated identity
(`Header.js:193-198`). Aggregate traffic figures are fetched per page and never
reach the layout. `StatisticsContent.js:107` fetches them for the statistics
route only, and the usage and quota routes fetch `/api/usage/providers` and
`/api/provider-nodes` for themselves.

Putting those figures in the masthead means adding a fetch and a hook call site
in layout scope, which the contract forbids.

**Recommended owner.** Backend session. The smallest sufficient change is one
aggregate endpoint, for example `/api/system/state`, returning throughput,
error rate, p95, failover count and connected-account count over a short
window, consumed once in the dashboard layout. A store-backed alternative would
work equally well.

**What shipped instead.** The masthead carries the system state that is
genuinely in scope: connectivity, current section, version and update
availability, and notification count. It is built to take telemetry the moment
an endpoint exists.

---

## 2. Provider health is a credential count, not a health state

**Files.** `src/app/(dashboard)/dashboard/providers/page.js`.

**What the design needs.** A provider health and quota matrix, signature
element 4, showing per upstream its recent error rate, latency and quota
headroom, so the degraded upstream is identifiable without leaving the page
whose name is Providers.

**Why it cannot be built.** The providers route knows how many connections a
provider has, and nothing about how they are performing. Latency, error rate
and quota headroom live behind `/api/usage/providers` and `/api/provider-nodes`,
which the providers route does not call. Calling them from this route adds
requests.

**Recommended owner.** Backend session. Either widen the payload the providers
route already receives to include a small health summary per provider, or
expose a single endpoint keyed by provider that the route can adopt.

**What shipped instead.** The connected upstreams are separated from the idle
inventory so the six accounts that carry traffic are no longer weighted equally
against forty that do not, using only data the route already has.

---

## 3. Fallback order is stored but never surfaced as a sequence

**Files.** `src/app/(dashboard)/dashboard/combos/page.js`.

**What the design needs.** Signature element 3, the patch bay, where channel
order is fallback order and each channel shows whether it is carrying, standing
by or failing.

**Why it is partly blocked.** The order itself is present and is now drawn as a
numbered sequence. Which channel is currently carrying traffic, and which
recently failed over, is runtime state that no endpoint reports.

**Recommended owner.** Backend session. A per-combo runtime summary reporting
the channel currently selected and the last failover timestamp would complete
this element.

**What shipped instead.** `Channel` and `ChannelList` in
`src/shared/components/ChannelList.js` render the ordering and accept a live
state the moment one is available.

---

## 4. Chart series colours are tokenised; the category mapping question is closed

**Files.** `src/app/(dashboard)/dashboard/statistics/StatisticsContent.js`,
`src/app/(dashboard)/dashboard/usage/components/UsageChart.js`.

**Status.** Closed by the presentation session. Both files now draw from
`--color-chart-1` through `--color-chart-6`, declared per theme in
`src/app/globals.css` and measured in `docs/design/tokens.pairs.json`.

**Why it was routed here and no longer needs to be.** The earlier reading was
that a series colour might be bound to a category the API defines, which would
make the mapping someone else's to decide. It is not. `StatisticsContent.js:409`
holds a fixed six-entry map and `UsageChart.js:119` and `:129` two literals,
both keyed by a local series name, so tokenising them needed no decision from
whoever owns the data.

**What it fixed.** Four legend labels on the statistics page failed text
contrast on the light surface, the worst at 2.54 against 4.5, and they were the
whole of the audit's remaining contrast findings. The usage chart's cost line
measured 1.8:1 as a stroke, under the 3:1 it needs to be seen.

**Recommended owner.** Nobody. Closed by the presentation session, and kept in
the list rather than deleted so a reader of the earlier report can see how it
resolved.

---

## 5. There is no right-to-left support, so Persian, Arabic and Hebrew render mirrored against the layout

**Files.** `src/app/layout.js:35`.

**What the design needs.** The root document to carry `lang` and `dir`
resolved from the locale, so a right-to-left locale mirrors the layout rather
than only reversing the characters within each line.

**Why it cannot be built here.** `src/app/layout.js` is outside this work's
writable surface, and the change is behavioural rather than presentational: the
direction has to be resolved from the locale cookie during the server render.
Setting it on the client would paint the wrong direction first and then flip.

**Evidence.** `docs/design/verification/audit-i18n.mjs` resolves `dir=ltr` for
Persian on all four routes measured. The root layout hardcodes
`<html lang="en">` with no `dir`, and the string `rtl` does not appear anywhere
under `src/`.

**Recommended owner.** Backend session. Read the locale cookie in the root
layout, set `lang` and `dir` on `<html>`, and keep one list of the
right-to-left locales. Migrating physical-direction utilities to logical ones
is worth nothing until `dir` is actually set, so it should follow rather than
lead.

**What shipped instead.** The behaviour is measured and documented rather than
assumed, in `docs/design/evidence/localisation-report.md`.

---

## 6. Four tests assert CSS class names that the accessibility work deliberately replaced

**Files.** `tests/unit/codex-plan-badge.test.js:86`,
`tests/unit/antigravity-verification-ui.test.js`,
`tests/unit/provider-strategy-writers.test.js`,
`tests/unit/provider-brand-icons.test.js`.

**What happens.** Run serially, 393 of 397 tests in the affected files pass and
these four fail. They are not flaky: they fail deterministically, and they fail
because the branch changed the exact strings they assert.

| Test | Asserts | Why it now fails |
|---|---|---|
| `codex-plan-badge` | markup contains `bg-brand-500/10` | `Badge.js` carried that class at the merge base and no longer does; the legacy primary alias was removed |
| `antigravity-verification-ui` | markup contains `focus-visible:ring-2` | focus indication was consolidated into one `focus-ring` utility carried by `Button` |
| `provider-strategy-writers` | source contains `text-red-500` | the raw colour was replaced by a semantic token |
| `provider-brand-icons` | `firecrawl_custom` is in the list of providers with no icon | the icon now exists at `public/providers/firecrawl_custom.png`, so the expected list of gaps is stale |

**Why they cannot be fixed here.** `tests/` is read-only for this work and the
fingerprint checker enforces that. Reverting the product to satisfy them would
undo an accessibility fix in three cases and re-open a missing asset in the
fourth.

**Note on the fourth.** `provider-brand-icons` fails because a defect was
closed. A test that encodes the current set of known gaps has to be updated when
a gap is filled, otherwise fixing a bug turns the suite red.

**Recommended owner.** Whoever owns `tests/`. The durable fix is to assert
behaviour rather than class names: that the badge is present and named, that the
control shows a focus indicator, that the element carries the danger role. A
test coupled to a Tailwind class fails on every restyle without catching a
single real defect.

**Verification note.** Nineteen further failures seen in a parallel run were
worker crashes under contention, not defects. They pass on a serial re-run. Only
run this suite serially when judging it.

---

## 7. The provider model-catalog fetch logs 401 and 404 on load, unchanged by this work

**Files.** `src/app/(dashboard)/dashboard/providers/[id]/page.js:549` and
`src/app/(dashboard)/dashboard/providers/[id]/CompatibleModelsSection.js:139`
call `/api/providers/<connectionId>/models`, served by
`src/app/api/providers/[id]/models/route.js`.

**What happens.** Across the 168 audited views, the console carries 21 responses
of 401 Unauthorized and 14 of 404 Not Found. The message set is identical before
and after this work, and this branch introduces none, which the audit gate now
asserts by comparing message sets rather than totals.

**Why it is not fixed here.** Both classes are request behaviour. Changing which
requests are made, or how their failures are handled, is exactly what the
behavioural contract forbids.

**Why it is worth fixing.** A console that is already noisy on every page load
is a console nobody reads, so the next real error is invisible. It also reads
badly to a developer evaluating whether to trust the project with credentials,
which is one of the two audiences this redesign serves.

**Which requests.** Traced by driving all 24 routes and recording every 4xx
response: three stored connections answer 401 on
`/api/providers/<id>/models` and two answer 404. The connection identifiers
differ per installation, so the counts above are for the seeded snapshot and
the shape is what matters, not the number.

**Recommended owner.** Backend session. A 401 here means a stored credential no
longer authenticates upstream, and a 404 means the connection resolves to
nothing; both are states the interface should be able to show as provider
health rather than states that only reach the console. This is the same data
gap as finding 2: if these outcomes were reported in the providers payload, the
health matrix could render them and the console would fall quiet.

**Evidence.** `node docs/design/verification/check-reports.mjs --console-network`
prints the full message set with counts.
