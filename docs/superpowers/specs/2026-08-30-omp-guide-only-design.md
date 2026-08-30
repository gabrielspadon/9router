# Oh My Pi Guide-Only Adaptation

**Date:** 2026-08-30
**Status:** Approved safe first slice of upstream PR #3272. Ready for design review.

## Decision

Adapt Oh My Pi as one `CLI_TOOLS.omp` registry entry with
`configType: "guide"`. The existing default branch in `ToolDetailClient.js`
will render it through `DefaultToolCard`. The entry displays the official
installation command, lets the user select a 9Router API key, gives a copyable
`~/.omp/agent/models.yml` template, and lets Oh My Pi discover its own models
at the 9Router `/v1/models` endpoint.

This is dashboard documentation, not an integration runtime. The dashboard
never installs Oh My Pi, detects its state, reads or writes its configuration,
probes a provider, starts a process, or chooses model roles. The template
intentionally names no models. Oh My Pi owns discovery and subsequent model
and role selection.

The only production owner is `src/shared/constants/cliTools.js`, plus a small
testability-preserving extraction in the existing
`src/app/(dashboard)/dashboard/cli-tools/components/DefaultToolCard.js`. The
extraction exposes the component's current placeholder replacement as a named,
dependency-free helper and preserves output for every existing guide. It proves
that the OMP template receives exactly one `/v1` suffix. No custom OMP
component, route, status adapter, API client, dependency, or packaged-CLI work
is part of this slice.

## Current Constraints

The checked-in `DefaultToolCard` already renders `guideSteps`, a selectable API
key, a copy button, and a code block. Its current `replaceVars` logic appends
`/v1` only when the supplied base URL lacks that suffix, then substitutes
`{{apiKey}}` and `{{model}}`. `ToolDetailClient` sends every tool without a
custom case to this card, so a guide registry entry reaches the detail UI
without new routing or client state.

`CLIToolsPageClient` can list the new registry item without a status adapter.
Because `all-statuses` does not know `omp`, `ToolSummaryCard` presents an
honest `Unknown` status. The guide must say that this status is not OMP
detection and must not be reinterpreted as installed, unavailable, or
connected.

Oh My Pi v18 documents custom OpenAI-compatible provider definitions in
`~/.omp/agent/models.yml`. Its provider-level `api: openai-completions` accepts
`discovery.type: openai-models-list`. That discovery obtains the model list
from the configured OpenAI-compatible base URL. The 9Router card therefore
uses the dashboard's existing `{{baseUrl}}` placeholder and relies on the
existing card to resolve it to a URL ending exactly once in `/v1`.

The upstream PR #3272 bundled this small user-facing capability with about
3,500 lines of API, filesystem, project-root, global-YAML, status, and CLI
surface. Its patch no longer applies cleanly to the current master. Reusing its
writer design would expand authority and supply-chain risk without improving
this initial copyable guide.

## Approaches Considered

### Merge the upstream implementation

Rejected. It creates API routes and YAML writers that can mutate per-project
and global OMP configuration. It also introduces an OMP status model and
packaged CLI work. Those capabilities require an explicit consent and security
design, and are not necessary for users to copy a correct configuration.

### Add a custom OMP dashboard card

Rejected. `DefaultToolCard` already provides the required accessibility,
selected-key control, copy affordances, guide-step layout, and responsive
dashboard presentation. A custom card would duplicate those behaviors and
create an unnecessary UI surface.

### Register an OMP guide with the existing default card

Selected. A declarative guide entry is the narrowest owner. It is visible in
the existing dashboard list and detail route, preserves the existing page and
packaged-dashboard architecture, and exposes no local or remote mutation.

## Data and Display Contract

Add this conceptual entry to `CLI_TOOLS` near the other terminal tools. The
exact color and descriptive copy may follow existing registry style, but the
fields and template below are contractual.

```js
omp: {
  id: "omp",
  name: "Oh My Pi",
  icon: "terminal",
  color: "#4F46E5",
  description: "Oh My Pi coding agent with 9Router model discovery",
  configType: "guide",
  notes: [
    {
      type: "info",
      text: "This guide does not detect Oh My Pi or write local configuration. Copy the template into your own models.yml file.",
    },
  ],
  guideSteps: [
    {
      step: 1,
      title: "Install Oh My Pi",
      value: "curl -fsSL https://omp.sh/install | sh",
      copyable: true,
    },
    {
      step: 2,
      title: "Choose a 9Router API key",
      type: "apiKeySelector",
    },
    {
      step: 3,
      title: "Create models.yml",
      desc: "Create ~/.omp/agent/models.yml, then copy the template below.",
      value: "~/.omp/agent/models.yml",
      copyable: true,
    },
    {
      step: 4,
      title: "Discover models in Oh My Pi",
      desc: "Start Oh My Pi and use its model selection workflow. The provider fetches its model list from 9Router.",
    },
  ],
  codeBlock: {
    language: "yaml",
    code: `providers:
  9router:
    baseUrl: {{baseUrl}}
    api: openai-completions
    apiKey: {{apiKey}}
    authHeader: true
    discovery:
      type: openai-models-list`,
  },
},
```

The YAML block is deliberately model-less. It must contain neither `models:`
nor `modelRoles:`, and it must not contain `{{model}}`. It must not advise
writing `config.yml`, setting `OMP_PROJECT_ROOTS`, using a project directory,
or selecting a default model on the user's behalf.

Use a Material Symbol `terminal` rather than an image file. This avoids adding
an unverifiable upstream logo asset and keeps the only visible addition within
the registry. The primary icon must have the same accessible tool name supplied
by the existing card, `Oh My Pi`.

`DefaultToolCard` receives no OMP-specific branch. Extract its present string
logic to a named helper such as `replaceGuideVariables(text, options)`, then
have the component call that helper. Its normal bare-URL and exact-`/v1`
outputs, API-key fallback, and model fallback remain byte-for-byte compatible
with the existing guides. The one intentional normalization is removal of
trailing slashes before deciding whether to append `/v1`.

| Input base URL | Required `{{baseUrl}}` output |
| --- | --- |
| `http://localhost:20128` | `http://localhost:20128/v1` |
| `https://router.example/v1` | `https://router.example/v1` |
| `https://router.example/v1/` | `https://router.example/v1` |

The helper first removes one or more trailing slashes from an ordinary base URL,
then preserves an ending `/v1` or appends a single `/v1`. It must never emit
`/v1/v1` or `/v1//v1`. It retains the existing key fallback and `{{model}}`
fallback for other cards. The OMP card itself supplies only `{{baseUrl}}` and
`{{apiKey}}`. The rendered YAML always uses an unquoted endpoint, as required
by the current Oh My Pi schema. The API key is copied as YAML scalar content
exactly as the existing guide card substitutes it. This slice does not add a
YAML serializer or attempt to escape, validate, save, or transmit that value.

## Strict TDD Boundary

Write tests before production edits and capture each focused test failing for
the intended missing behavior. The tests belong in two focused files.

`tests/unit/omp-cli-guide.test.js` imports `CLI_TOOLS` and verifies all of the
following.

| Case | Required assertion |
| --- | --- |
| Registry identity | `CLI_TOOLS.omp.id` is `omp`, its name is `Oh My Pi`, it uses `configType: "guide"`, and it has a `terminal` icon rather than an image path. |
| Real guide UI | `guideSteps` is nonempty, includes one `apiKeySelector`, and includes no `modelSelector`, `settingsFile`, `envVars`, `defaultModels`, or writer-related metadata. |
| Exact OMP v18 template | The trimmed code block equals the YAML in this design byte for byte, has language `yaml`, and preserves both `{{baseUrl}}` and `{{apiKey}}`. |
| Model-less discovery | The template includes `api: openai-completions`, `authHeader: true`, and `discovery.type: openai-models-list`, while excluding `{{model}}`, `models:`, and `modelRoles:`. |
| Zero write surface | No OMP API route exists, the registry does not declare a settings path or writer command, and the source tree has no OMP-specific `all-statuses` entry or dashboard route. |

`tests/unit/default-tool-card-template.test.js` imports only the new pure
placeholder helper. It proves all three base-URL rows above, including that
`https://router.example/v1/` becomes exactly
`https://router.example/v1`. It asserts that neither `/v1/v1` nor `/v1//v1`
is emitted, that an API key replaces `{{apiKey}}`, and that an exact `/v1`
base URL remains unchanged. It also covers the existing no-key fallback and an
ordinary `{{model}}` replacement so the extraction preserves every normal
existing guide output.

The red sequence is this.

1. Add the OMP registry and template assertions. They must fail because `omp`
   does not exist.
2. Add the pure interpolation assertions for bare, exact-`/v1`, and
   trailing-slash base URLs. They must fail because the named helper does not
   exist and the current inline logic duplicates `/v1/`.
3. Add only the registry entry and the behavior-preserving helper extraction.
   Re-run the two tests until green.

Then run the existing `openclaude-cli-tool-1807.test.js` guide regression. It
must remain green, proving the generic substitution change did not change an
existing guide's API-key or model behavior. No test may start a dashboard
server, install OMP, run its installer, call `/v1/models`, create a user file,
or use a filesystem mock as a substitute for a real writer.

## Verification Contract

Implementation verification runs the two new focused tests and the existing
OpenClaude guide test together. It then runs the affected dashboard unit suite,
lint for the changed registry, card, and tests, and the repository's normal
static checks. `npm run cli:pack` remains a packaging regression gate. The
guide must be reachable through the ordinary dashboard bundle without any
change below `cli/`.

Review the final diff with these explicit checks.

1. The only production changes are `cliTools.js` and the existing
   `DefaultToolCard.js` helper extraction.
2. No file below `cli/` changes, including `cli/package.json`, `cli/cli.js`,
   and `cli/scripts/build-cli.js`.
3. No `src/app/api/cli-tools/omp*` route, status adapter, OMP client, YAML
   parser, package dependency, migration, installer invocation, or background
   process appears.
4. The OMP detail view reaches the default guide path and all copy operations
   remain user initiated.
5. The dashboard summary retains `Unknown` without any status probe. It must
   not use an OMP installed, connected, or unavailable label.

## Non-goals

- No files, API routes, project roots, global YAML writer, filesystem read, or
  filesystem write.
- No packaged CLI alteration, CLI dependency, OMP binary download, installer
  execution, process launch, or startup detection.
- No OMP status polling, model fetch, credential validation, remote API
  request, automatic model choice, model-role persistence, or model mapping.
- No custom dashboard component, special detail-route branch, new locale copy,
  image asset, or setting page.
- No attempt to merge the upstream project's broader config-management
  implementation before a separate consent, security, and lifecycle design.

## Design Self-Review

This design gives the feature one declarative registry owner and reuses the
current accessible card. It pins the current OMP v18 schema and the exact
model-less discovery template, including single-suffix endpoint interpolation.
It separates intentional user copy from every prohibited write or probe,
preserves ordinary guide behavior with a focused helper test, and makes the
packaged CLI a verification boundary rather than a changed product surface.
There is no placeholder, implicit writer authority, or downstream implementation
choice left unresolved for this first slice.
