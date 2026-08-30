# Critique, from driving the product

Captured on the isolated instance (port 20135) seeded from a read-only
backup of a live database, so the observations below are against realistic
routing data rather than an empty install. Six accounts are connected across
three providers (Claude Code 3, Antigravity 2, OpenAI Codex 1); the remaining
forty or so providers are configured but idle.

Evidence for every claim is a captured view under `docs/design/evidence/routes/before/`.

## The one-sentence problem

9Router is an instrument that never tells you its reading. Every screen is a
configuration form; no screen is a gauge. An operator who keeps the dashboard
open all day can answer "what did I set up" instantly and cannot answer "is it
working right now" at all.

## Findings

### 1. There is no focal answer on any screen

`dashboard-home--dark--desktop.png` is the endpoint form. It shows a URL, two
tunnel toggles, and an API key. Nothing on the landing screen of a routing
gateway reports throughput, error rate, active provider, or failover state.
The brief's five-second test fails on the product's front page, because the
front page is a settings pane.

### 2. Provider health is not represented, only provider inventory

`providers--dark--desktop.png` renders forty-plus providers as one uniform grid
of rounded cards. The three that actually carry traffic are marked only by a
small green "3 Connected" pill, which is a count of credentials, not a health
state. Nowhere on the page is latency, quota headroom, recent failure, or rate
limit. Finding the unhealthy upstream requires leaving this page, which is the
exact task the page is named for.

### 3. Equal weight for unequal information

`statistics--dark--desktop.png` gives nine metric tiles identical size, colour
and position. Requests, Cache Write and Avg TTFT are rendered as peers. Eight of
the nine read zero or a dash, so the dominant visual mass of the page is empty
scaffolding. The trends panel occupies roughly a third of the viewport to say
"No data for this selection".

### 4. Card chrome substitutes for structure

Every region on every route is a rounded rectangle on a slightly different
background. Because the card is the only grouping device, it carries no meaning:
a portable object (an API key) and a page section (Model Discovery) look the
same. Grouping by rule, band, inset and rhythm is unused, so scanning depends
entirely on reading headings.

### 5. Navigation is a flat list of seventeen destinations

The rail lists Endpoint, Providers, Combo, Usage, Statistics, Quota, Token
Saver, Memory, Claude Compat, CLI Tools, then a SYSTEM group of eight more. The
four things the product actually does (connect, compose, point, watch) are not
expressed. Usage, Statistics and Quota are three separate destinations that all
answer "how is it going", while Endpoint and CLI Tools both answer "where do I
point my client".

### 6. The routing chain, the product's whole reason to exist, is invisible

Combos define fallback order. Nothing in the interface draws that order. There
is no representation of a request entering, choosing a channel, failing over,
and leaving. The topology exists in the data model and nowhere on screen.

### 7. Dead canvas at every desktop width

At 1440 the content column stops near 1400 and the right third of the endpoint
page is empty. The layout is a centred column inside a wide viewport, so the
extra width buys nothing. An operator's monitor is treated as a phone with
margins.

### 8. Status is carried by hue in places

The audit records hue-only indicators on the login and landing views
(three and one respectively), where a small saturated element carries state with
no text, icon or accessible name. An earlier pass fixed contrast and accessible names
thoroughly; this class was not in its scope.

## What the earlier pass already fixed, and must not regress

The earlier pass measured and closed contrast, focus indication and accessible names.
The baseline audit records zero contrast failures, zero unnamed icon controls
and zero missing focus rings across the routes it covers. This pass changes
composition and hierarchy; it inherits that floor and is measured against it.
