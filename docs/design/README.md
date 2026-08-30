# The design record

Why the interface looks the way it does, and the evidence each claim rests on.
Every gate here re-runs from a clean checkout; a gate that cannot be re-run is
not a gate.

## Read first

- [design-system.md](design-system.md). The rules the interface obeys. Semantic
  colour tokens with measured contrast, typography roles, grid and density,
  structure, elevation, radius, motion, focus, and the data visualisation
  grammar. Where asymmetry is allowed and where alignment is mandatory.
- [direction.md](direction.md). The three structural hypotheses that were
  drawn, how they scored against the product's four jobs, and why the chosen one
  won. [critique.md](critique.md) is the honest reading of what the first
  pass got wrong.
- [artboards/](artboards/). The three hypotheses as running HTML, each rendered
  in both themes across three states.
- [not-changed.md](not-changed.md). Areas deliberately left alone, with the
  reason for each.
- [backend-handoff.md](backend-handoff.md). Findings that need a behavioural
  change, with file, line, reason and owner. Presentation work does not cross
  that boundary.
- [translation-policy.md](translation-policy.md). Why the README ships in
  English only.
- [progressive-tool-disclosure.md](progressive-tool-disclosure.md). An engine
  behaviour that is documented under this directory for historical reasons
  rather than a design page. `docs/README.md` links it from Reference.

## Evidence

`evidence/` holds what was measured rather than what was asserted.

- `evidence/raw/*.json`. The machine-readable capture every gate reads: the
  browser audit and the capability inventory, before and after.
- `evidence/routes/{before,after}/`. Every route, both themes, three viewports
  and a 200 percent zoom view.
- `evidence/audit-report.md`, `evidence/localisation-report.md` and
  `evidence/verification-summary.md`. The derived reports.
- `evidence/gallery/`. The component gallery in both themes, which is the visual
  regression snapshot for the shared primitives.

## Re-running the gates

Playwright is not a dependency of this repository. Point `NODE_PATH` at an
installation that has it.

```bash
# 1. an isolated instance: its own port, its own DATA_DIR, production untouched
docs/design/verification/instance.sh up          # R3_PORT overrides the default

# 2. capture, then publish the screenshots as the committed webp corpus
export NODE_PATH=/path/to/node_modules           # one that provides playwright
node docs/design/verification/inventory.mjs after http://127.0.0.1:20135
node docs/design/verification/audit2.mjs    after http://127.0.0.1:20135
node docs/design/verification/publish-shots.mjs after

# 3. every gate
for c in docs/design/verification/check-*.mjs; do node "$c" || echo "FAILED $c"; done
bash docs/design/verification/check-quality.sh   # lint delta, regression, smoke
```

`check-behaviour.mjs` is the one that matters most: it builds a single multiset
over the whole source tree of hook call sites, event-handler bodies, fetch and
axios calls with their arguments, request-path literals, state setters and
imports from the routing, store, model and API layers, and compares it against
the merge base. Entries carry no filename, so a control may move between
components; it may not change. `prove-behaviour-sensitive.sh` proves the checker
is not vacuous by injecting cases it must catch.
