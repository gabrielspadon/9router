# Oh My Pi Guide-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe Oh My Pi dashboard guide that gives users a copyable,
model-less OMP v18 `models.yml` template for 9Router `/v1` discovery, without
installing, probing, or writing any OMP state.

**Architecture:** Add one declarative `CLI_TOOLS.omp` guide entry. The existing
default branch in `ToolDetailClient` renders it with `DefaultToolCard`, so the
feature adds no special route or card. Extract the card's placeholder logic to
a pure named helper so a focused test can lock single-suffix `/v1`
normalization while preserving ordinary existing guide output.

**Tech Stack:** Next.js dashboard, plain JavaScript ESM, React, Vitest, ESLint,
and the repository's existing CLI pack script.

## Global Constraints

- Production scope is exactly `src/shared/constants/cliTools.js` and
  `src/app/(dashboard)/dashboard/cli-tools/components/DefaultToolCard.js`.
- Test scope is exactly `tests/unit/omp-cli-guide.test.js` and
  `tests/unit/default-tool-card-template.test.js`.
- The OMP entry uses `configType: "guide"`, the existing default card, a
  Material Symbol `terminal`, and no custom `ToolDetailClient` switch case.
- The existing Material Symbol span has no separate accessible-name contract.
  This slice preserves that existing visual-icon behavior and does not claim or
  add OMP-specific ARIA semantics.
- The copied OMP v18 YAML is model-less and contains exactly the provider-level
  `baseUrl`, `api: openai-completions`, `apiKey`, `authHeader: true`, and
  `discovery.type: openai-models-list` fields specified below.
- `{{baseUrl}}` must resolve to exactly one `/v1` for bare URLs, `/v1` URLs,
  and trailing-slash `/v1/` URLs. It must never produce `/v1/v1` or `/v1//v1`.
- Preserve all normal existing guide output, including the existing API-key
  fallback and `{{model}}` fallback. The only intentional generic change is
  trailing-slash normalization before the `/v1` decision.
- No files, API routes, project roots, global YAML writer, filesystem read, or
  filesystem write are added.
- No OMP status probe, model fetch, credential validation, remote request,
  automatic model choice, role persistence, package dependency, installer
  invocation, process launch, startup detection, or `cli/` change is allowed.
- Do not start a dashboard server or install OMP during verification.

## File Map

| File | Action | Responsibility |
| --- | --- | --- |
| `src/app/(dashboard)/dashboard/cli-tools/components/DefaultToolCard.js` | Modify | Export a pure placeholder helper and delegate the existing card replacement to it. |
| `tests/unit/default-tool-card-template.test.js` | Create | Pin bare, exact-`/v1`, trailing-slash, API-key, and model placeholder behavior. |
| `src/shared/constants/cliTools.js` | Modify | Declare the sole OMP guide, its copyable steps, and exact model-less YAML. |
| `tests/unit/omp-cli-guide.test.js` | Create | Pin registry identity, guide UI contract, exact YAML, default-card routing, and zero-write boundaries. |

Set an implementation baseline immediately before Task 1.

```bash
implementation_base=$(git rev-parse HEAD)
printf '%s\n' "$implementation_base"
```

Use this value only for the final scope check. It excludes this approved design
and plan documentation from the implementation diff.

---

### Task 1: Extract and pin guide placeholder normalization

**Files:**

- Modify: `src/app/(dashboard)/dashboard/cli-tools/components/DefaultToolCard.js:10-35`
- Create: `tests/unit/default-tool-card-template.test.js`

**Interfaces:**

- Consumes: the current `DefaultToolCard` props `baseUrl`, `selectedApiKey`,
  `cloudEnabled`, and `modelValue`.
- Produces: `replaceGuideVariables(text, { baseUrl, apiKey, cloudEnabled,
  model })`, a named export that returns `text` with each known placeholder
  replaced. It remains the only interpolation path called by `DefaultToolCard`.

- [ ] **Step 1: Write the failing helper contract test**

Create `tests/unit/default-tool-card-template.test.js` with this test surface.

```js
import { describe, expect, it } from "vitest";
import { replaceGuideVariables } from "@/app/(dashboard)/dashboard/cli-tools/components/DefaultToolCard.js";

const template = "base={{baseUrl}} key={{apiKey}} model={{model}}";

describe("DefaultToolCard guide template replacement", () => {
  it.each([
    ["bare URL", "http://localhost:20128", "http://localhost:20128/v1"],
    ["exact /v1 URL", "https://router.example/v1", "https://router.example/v1"],
    ["trailing-slash /v1 URL", "https://router.example/v1/", "https://router.example/v1"],
  ])("normalizes %s to one /v1", (_name, baseUrl, expectedBaseUrl) => {
    const output = replaceGuideVariables(template, {
      baseUrl,
      apiKey: "sk-test",
      cloudEnabled: false,
      model: "provider/model",
    });

    expect(output).toBe(`base=${expectedBaseUrl} key=sk-test model=provider/model`);
    expect(output).not.toContain("/v1/v1");
    expect(output).not.toContain("/v1//v1");
  });

  it("preserves current API-key and model fallbacks", () => {
    expect(replaceGuideVariables("{{apiKey}}|{{model}}", {
      baseUrl: "http://localhost:20128",
      apiKey: "",
      cloudEnabled: false,
      model: "",
    })).toBe("sk_9router|provider/model-id");

    expect(replaceGuideVariables("{{apiKey}}", {
      baseUrl: "http://localhost:20128",
      apiKey: " ",
      cloudEnabled: true,
      model: "",
    })).toBe("your-api-key");
  });
});
```

- [ ] **Step 2: Run the new test and record RED**

Run from `tests/`.

```bash
npx vitest run unit/default-tool-card-template.test.js
```

Expected result: FAIL during collection because `DefaultToolCard.js` has no
named `replaceGuideVariables` export. Do not add a second interpolation path or
alter unrelated card rendering to satisfy this test.

- [ ] **Step 3: Implement the smallest pure helper extraction**

At module scope after the imports in `DefaultToolCard.js`, add this export.

```js
export function replaceGuideVariables(text, {
  baseUrl,
  apiKey,
  cloudEnabled = false,
  model,
} = {}) {
  const keyToUse = (apiKey && apiKey.trim())
    ? apiKey
    : (!cloudEnabled ? "sk_9router" : "your-api-key");
  const configuredBaseUrl = baseUrl || "http://localhost:20128";
  const normalizedBaseUrl = configuredBaseUrl.replace(/\/+$/, "");
  const baseUrlWithV1 = normalizedBaseUrl.endsWith("/v1")
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/v1`;

  return text
    .replace(/\{\{baseUrl\}\}/g, baseUrlWithV1)
    .replace(/\{\{apiKey\}\}/g, keyToUse)
    .replace(/\{\{model\}\}/g, model || "provider/model-id");
}
```

Replace the local `replaceVars` body with this single delegation.

```js
const replaceVars = (text) => replaceGuideVariables(text, {
  baseUrl,
  apiKey: selectedApiKey,
  cloudEnabled,
  model: modelValue,
});
```

Do not add an OMP branch, fetch, state, effect, filesystem call, YAML parser,
or copy behavior. The card still owns selection state and calls `replaceVars`
for guide values and code blocks exactly as before.

- [ ] **Step 4: Run GREEN and the existing guide regression**

Run from `tests/`.

```bash
npx vitest run unit/default-tool-card-template.test.js unit/openclaude-cli-tool-1807.test.js
```

Expected result: PASS. The new helper covers the only intentional trailing
slash correction while the OpenClaude card retains its base URL, API key, and
model substitutions.

- [ ] **Step 5: Commit the self-contained helper slice**

```bash
git add 'src/app/(dashboard)/dashboard/cli-tools/components/DefaultToolCard.js' \
  tests/unit/default-tool-card-template.test.js
git diff --cached --check
git diff --cached --name-only
git commit -m "refactor(cli-tools): normalize guide URLs"
git log -1 --oneline
```

Expected staged paths are exactly the card and its new helper test.

---

### Task 2: Register the model-less OMP guide

**Files:**

- Modify: `src/shared/constants/cliTools.js:145-172`
- Create: `tests/unit/omp-cli-guide.test.js`

**Interfaces:**

- Consumes: `CLI_TOOLS` and the default `ToolDetailClient` branch already used
  for generic guides.
- Produces: `CLI_TOOLS.omp`, a `configType: "guide"` value consumed unchanged
  by `DefaultToolCard`. It exposes only installation text, selected-key
  substitution, and a user-copyable `models.yml` template.

- [ ] **Step 1: Write the failing OMP registry and boundary test**

Create `tests/unit/omp-cli-guide.test.js` with this exact contract.

```js
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const { CLI_TOOLS } = await import("../../src/shared/constants/cliTools.js");
const tool = CLI_TOOLS.omp;
const expectedYaml = `providers:
  9router:
    baseUrl: {{baseUrl}}
    api: openai-completions
    apiKey: {{apiKey}}
    authHeader: true
    discovery:
      type: openai-models-list`;

function source(relativePath) {
  return fs.readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("Oh My Pi CLI guide", () => {
  it("registers a default-card guide without an image asset", () => {
    expect(tool.id).toBe("omp");
    expect(tool.name).toBe("Oh My Pi");
    expect(tool.configType).toBe("guide");
    expect(tool.icon).toBe("terminal");
    expect(tool.image).toBeUndefined();
  });

  it("offers a copyable install, key, path, and discovery workflow", () => {
    expect(tool.guideSteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ step: 1, value: "curl -fsSL https://omp.sh/install | sh", copyable: true }),
      expect.objectContaining({ step: 2, type: "apiKeySelector" }),
      expect.objectContaining({ step: 3, value: "~/.omp/agent/models.yml", copyable: true }),
      expect.objectContaining({ step: 4, title: "Discover models in Oh My Pi" }),
    ]));
    expect(tool.guideSteps.map((step) => step.type).filter(Boolean)).toEqual(["apiKeySelector"]);
    expect(tool.guideSteps.some((step) => step.type === "modelSelector")).toBe(false);
  });

  it("pins the exact model-less OMP v18 discovery template", () => {
    expect(tool.codeBlock.language).toBe("yaml");
    expect(tool.codeBlock.code.trim()).toBe(expectedYaml);
    expect(tool.codeBlock.code).not.toContain("{{model}}");
    expect(tool.codeBlock.code).not.toContain("models:");
    expect(tool.codeBlock.code).not.toContain("modelRoles:");
  });

  it("uses the existing default guide route without any OMP writer or status adapter", () => {
    const detailSource = source("../../src/app/(dashboard)/dashboard/cli-tools/[toolId]/ToolDetailClient.js");
    const statusesSource = source("../../src/app/api/cli-tools/all-statuses/route.js");
    const ompRoute = fileURLToPath(new URL("../../src/app/api/cli-tools/omp/route.js", import.meta.url));

    expect(detailSource).toContain("default:");
    expect(detailSource).toContain("<DefaultToolCard");
    expect(detailSource).not.toContain('case "omp"');
    expect(statusesSource).not.toMatch(/["']omp["']/);
    expect(fs.existsSync(ompRoute)).toBe(false);
    expect(tool.settingsFile).toBeUndefined();
    expect(tool.envVars).toBeUndefined();
    expect(tool.defaultModels).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the registry test and record RED**

Run from `tests/`.

```bash
npx vitest run unit/omp-cli-guide.test.js
```

Expected result: FAIL because `CLI_TOOLS.omp` is absent. The test must not be
weakened by adding a model selector, status probe, filesystem mock, route, or
writer abstraction.

- [ ] **Step 3: Add the declarative OMP guide only**

Insert this entry in `CLI_TOOLS` after `openclaude` or another nearby terminal
guide. Leave `ToolDetailClient`, `CLIToolsPageClient`, `ToolSummaryCard`, every
API route, and `cli/` untouched.

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

The guide is a user-visible copy aid only. It does not make a network request
when opened. Since no status adapter exists, the summary card remains `Unknown`
and must not claim OMP is installed, connected, or unavailable.

- [ ] **Step 4: Run GREEN with the generic guide regressions**

Run from `tests/`.

```bash
npx vitest run unit/default-tool-card-template.test.js unit/omp-cli-guide.test.js unit/openclaude-cli-tool-1807.test.js
```

Expected result: PASS. This proves the exact OMP guide contract and generic URL
normalization while retaining the existing OpenClaude guide behavior.

- [ ] **Step 5: Commit the self-contained guide slice**

```bash
git add src/shared/constants/cliTools.js tests/unit/omp-cli-guide.test.js
git diff --cached --check
git diff --cached --name-only
git commit -m "feat(cli-tools): add OMP configuration guide"
git log -1 --oneline
```

Expected staged paths are exactly the registry and the new OMP guide test.

---

### Task 3: Verify the approved integration boundary

**Files:**

- Modify: none
- Create: none
- Test: `tests/unit/default-tool-card-template.test.js`,
  `tests/unit/omp-cli-guide.test.js`, and
  `tests/unit/openclaude-cli-tool-1807.test.js`

**Interfaces:**

- Consumes: the exported `replaceGuideVariables` helper and `CLI_TOOLS.omp`
  delivered by Tasks 1 and 2.
- Produces: verification evidence that the dashboard guide is packaged through
  existing behavior and that no prohibited product surface entered the diff.

- [ ] **Step 1: Replay the complete focused test union**

Run from `tests/`.

```bash
npx vitest run unit/default-tool-card-template.test.js unit/omp-cli-guide.test.js unit/openclaude-cli-tool-1807.test.js
```

Expected result: PASS for all three files. A failure in the existing OpenClaude
test blocks completion because it indicates the generic card changed an
existing guide contract.

- [ ] **Step 2: Run scoped static checks**

Run from the repository root.

```bash
npx eslint src/shared/constants/cliTools.js \
  'src/app/(dashboard)/dashboard/cli-tools/components/DefaultToolCard.js' \
  tests/unit/omp-cli-guide.test.js \
  tests/unit/default-tool-card-template.test.js
git diff --check "$implementation_base"..HEAD
```

Expected result: both commands exit zero. Do not run a dashboard server because
the guide has no runtime, filesystem, or network behavior to exercise.

- [ ] **Step 3: Verify the packaged-dashboard boundary**

Run from the repository root.

```bash
repo_root=$(git rev-parse --show-toplevel)
pack_destination=$(cd "$repo_root/cli/../.." && pwd -P)
pre_pack_status=$(git status --short --untracked-files=all)
before_manifest=$(mktemp)
after_manifest=$(mktemp)
trap 'rm -f "$before_manifest" "$after_manifest"' EXIT
find "$pack_destination" -maxdepth 1 -type f -name '9router-*.tgz' -printf '%f\n' | sort > "$before_manifest"

npm run cli:pack

post_pack_status=$(git status --short --untracked-files=all)
printf '%s\n' "$post_pack_status"
test "$post_pack_status" = "$pre_pack_status" || {
  printf '%s\n' 'Unexpected tracked or untracked worktree mutation after cli:pack' >&2
  exit 1
}

find "$pack_destination" -maxdepth 1 -type f -name '9router-*.tgz' -printf '%f\n' | sort > "$after_manifest"
mapfile -t new_archives < <(comm -13 "$before_manifest" "$after_manifest")
test "${#new_archives[@]}" -eq 1 || {
  printf '%s\n' 'Expected exactly one new 9router archive after cli:pack' >&2
  printf '%s\n' 'Before:' >&2
  cat "$before_manifest" >&2
  printf '%s\n' 'After:' >&2
  cat "$after_manifest" >&2
  exit 1
}
new_archive="$pack_destination/${new_archives[0]}"
test -f "$new_archive"
tar -tzf "$new_archive" >/dev/null
rm -- "$new_archive"
test "$(git status --short --untracked-files=all)" = "$pre_pack_status"
```

`cli/package.json` sends its archive to `../..`, so the command resolves that
destination from the actual worktree instead of assuming a path. It records
preexisting package names before packaging, then permits exactly one new
`9router-*.tgz` file. Root and CLI ignores do not cover `.tgz` artifacts, so
the plan validates the exact new archive with `tar -tzf`, removes only that
resolved new path, and requires the tracked and untracked status to return to
the pre-pack state. Any status mutation, zero archive, or multiple new archive
names stops the task and is reported without deleting an ambiguous file.

Expected result: exit zero after cleanup. This confirms the ordinary CLI
packaging path still includes the dashboard after a root `src/` guide change.
It does not authorize editing `cli/`, publishing a package, installing the
generated archive, or starting a process.

- [ ] **Step 4: Prove final scope and zero prohibited surface**

Run from the repository root, using the baseline captured before Task 1.

```bash
git diff --name-only "$implementation_base"..HEAD | sort
git diff --name-only "$implementation_base"..HEAD -- cli
test -z "$(git diff --name-only "$implementation_base"..HEAD -- cli)"
git status --short
```

Expected changed implementation paths are exactly these four paths.

```text
src/app/(dashboard)/dashboard/cli-tools/components/DefaultToolCard.js
src/shared/constants/cliTools.js
tests/unit/default-tool-card-template.test.js
tests/unit/omp-cli-guide.test.js
```

Expected CLI-specific diff output is empty. Any source API route, OMP writer,
status adapter, project-root integration, package dependency, locale, image
asset, `ToolDetailClient` change, or `cli/` path is out of scope and blocks
completion pending a new design decision.

## Design-to-Plan Self-Review

| Approved requirement | Plan coverage |
| --- | --- |
| Existing `DefaultToolCard` and default dashboard route | Task 1 preserves its render path. Task 2 asserts the default route without an OMP switch case. |
| Exact model-less OMP v18 YAML | Task 2 has the full production snippet and byte-for-byte expected test string. |
| Bare, exact-`/v1`, and `/v1/` URLs | Task 1 gives the helper implementation and all three focused cases, excluding both duplicate forms. |
| Normal existing guide output | Task 1 retains API-key and model fallbacks. Tasks 1 through 3 replay the existing OpenClaude regression. |
| Zero writes, status, and CLI scope | Global constraints, Task 2 static boundaries, and Task 3 final diff checks prohibit every listed surface. |
| Lint and packaged CLI verification | Task 3 runs scoped ESLint and `npm run cli:pack` without changing or starting the CLI. |

The plan defines every produced symbol before it is consumed. Its only helper
name is `replaceGuideVariables`, and its only new registry key is `omp`. A
final manual read confirms that each command has a required exit result, every
production and test path is explicit, the OMP YAML is complete, and no deferred
choice, broad route, or writer permission remains.

## Execution Handoff

Plan complete and saved to
`docs/superpowers/plans/2026-08-30-omp-guide-only-implementation.md`.

Two execution options are available after plan review.

1. Subagent-Driven (recommended). Dispatch a fresh worker for each task and
   review the result between the two implementation slices.
2. Inline Execution. Execute Tasks 1 through 3 in this worktree with strict
   RED/GREEN checkpoints and one review after each committed slice.

This task is awaiting plan review. Do not start either execution option until
the plan is approved.
