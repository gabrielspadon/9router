# Structural direction, scored and selected

Three structural hypotheses were built as working artboards rather than
described. Each renders the same three states in both themes, from the same
token sheet, so the comparison is structural and not a matter of styling.

Sources: `docs/design/artboards/a1-signal-room.html`,
`a2-route-atlas.html`, `a3-switchboard.html`.
Renders: `docs/design/artboards/render/` (18 images, three states, two themes).

States rendered for each: dashboard home under realistic traffic, provider
detail with one degraded upstream, and a phone view during an actionable
failure. Navigation, focus, hover, disabled, loading, disclosure and error
states appear across the three.

## Scores

Scored 1 to 5 against the criteria the brief names. Higher is better.

| Criterion | A1 Signal Room | A2 Route Atlas | A3 Switchboard |
|---|---|---|---|
| Expresses the four product jobs | 4 | 2 | 5 |
| Action visibility | 4 | 4 | 4 |
| Time to identify an unhealthy provider | 5 | 3 | 5 |
| Clarity of fallback order | 4 | 5 | 5 |
| Keyboard path | 5 | 3 | 4 |
| Small-screen resilience | 4 | 3 | 3 |
| Localisation resilience | 4 | 4 | 2 |
| Compatibility with the behaviour contract | 5 | 3 | 3 |
| **Total** | **35** | **27** | **31** |

## Why each score

**A1 Signal Room, 35.** The masthead answers "is the system healthy" before
the eye reaches the content, on every route, which is the brief's five-second
test. The rail is a vertical list, so the tab order stays linear and the
twenty-four existing destinations each keep a slot. It scores lower on naming
the four jobs because the jobs appear as group headings rather than as
destinations.

**A2 Route Atlas, 27.** It draws fallback order better than either rival; the
numbered spine with junction metrics is the clearest statement of what a combo
actually is. It fails as a whole-product shell. System state is only reachable
after choosing a route, so most screens have no focal answer. Worse for the
contract, roughly a third of the existing routes (skills, memory, mitm, pxpipe,
proxy pools, media providers) are not routes in the atlas sense and have no
home, which risks pushing them more than one action away.

**A3 Switchboard, 31.** Naming Connect, Compose, Point and Watch as the four
top-level destinations is the most legible statement of the product. The patch
bay, where channel order is literally fallback order, is excellent. It loses on
two measurable constraints. A fixed four-column tab grid is the worst case for
localisation, since German and Vietnamese labels have no room to wrap, and at
390 pixels the four tabs are already cramped in the rendered state C. Folding
twenty-four destinations behind four tabs also puts part of the long tail two
actions deep, which the behaviour contract forbids.

## Selected direction

**A1 Signal Room**, with two grafts.

From **A3 Switchboard**, adopt the four jobs as the explicit grouping of the
command rail (Connect, Compose, Point, Watch, with the residual operational
tools under a fifth group), and adopt the patch bay as the presentation of a
combo, where the channel number is the fallback position.

From **A2 Route Atlas**, adopt the route spine and the flow strip for the
Compose surfaces, where explaining the chain is the whole job.

This keeps the persistent focal answer and the linear keyboard path that made
A1 win, buys A3's clarity about what the product does without inheriting its
localisation and small-screen costs, and buys A2's topology where topology is
the subject rather than as wallpaper.

## Signature elements

Five, each carrying real information or enabling a real action.

1. **System-state masthead.** Throughput, p95 latency, error rate, failover
   rate and spend, plus a degraded count, persistent across every route.
2. **Numbered command rail grouped by the four jobs.** The number is a stable
   address, not decoration.
3. **Patch bay with numbered channels.** Channel order is fallback order, shown
   as sequence rather than described in prose.
4. **Provider health and quota matrix.** Health, headroom, latency and error
   rate for every connected upstream in one grid.
5. **Endpoint handoff strip.** The one URL a client needs, with copy and a
   ready-made request, reachable from the masthead on every route.

## Rules carried into the system

Asymmetry lives at page scale, in the offset rail, the split panes and the
unequal column ratios. Alignment is strict inside them: every table, readout
and control sits on the same grid and every quantity uses tabular numerals.
Cards are reserved for portable objects. Sections are separated by rule, band
and inset instead. Status is never carried by hue alone; every status token
pairs a colour with a glyph and a word.
