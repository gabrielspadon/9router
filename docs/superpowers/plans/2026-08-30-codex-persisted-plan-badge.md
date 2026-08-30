# Codex Persisted Plan Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display a compact, accessible persisted Codex subscription-plan badge on a Codex connection row without a render-time network request or quota behavior change.

**Architecture:** Keep plan selection in a named pure helper inside the existing ConnectionRow component. The row reads the already loaded connection.providerSpecificData and conditionally renders an existing primary Badge. A real SSR test imports the helper and row, proving the selection contract and that rendering never invokes a throwing fetch mock.

**Tech Stack:** JavaScript ES modules with JSX, React server rendering, Vitest 4, ESLint 9, Next.js 16.

## Global Constraints

- Frozen implementation base is `19504c5a7028e5540b462c7bcc59126d34ceff25`, which contains the approved design and strengthened SSR test contract.
- Work only in `/home/spadon/Codebases/9router/.claude/worktrees/task-8-pr3210` on `integration/task8-pr3210`.
- Own exactly `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js` and `tests/unit/codex-plan-badge.test.js` during implementation.
- Do not modify the approved design or this plan during implementation.
- Do not edit the provider-detail page, ProviderLimits, API routes, persistence, OAuth, usage services, registry, dependency files, tracking, snapshots, generated files, canonical, or upstream.
- Do not cherry-pick or raw-apply PR #3210. Its live `/api/usage/<connectionId>` probe is forbidden.
- The only input is `connection.providerSpecificData` already present in the row prop. No plan state, effect, callback, refresh, write, or remote request is allowed.
- `codexSubscriptionPlan` wins when it is a non-empty trimmed string other than case-insensitive `unknown`. Otherwise use valid legacy `chatgptPlanType`. A non-Codex row and two unusable values return `null`.
- The badge is `variant="primary"`, `size="sm"`, immediately follows the authentication badge, and has hidden `Codex subscription plan` text.
- Use strict TDD. Save the intentional RED before source changes, then record focused, adjacent, lint, diff, and scope GREEN evidence before committing.
- Stage only the two owned paths. Make one conventional commit, push once normally to `origin integration/task8-pr3210`, and compare its explicit fork ref to local HEAD. Do not push while branch CI is pending.

---

## File Map

### Modified

- `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js` owns the exported pure resolver, one local `codexPlan` value, optional accessible Badge, and matching optional PropTypes fields. It changes no lifecycle or request behavior.

### Created

- `tests/unit/codex-plan-badge.test.js` owns deterministic precedence, invalid-value, non-Codex, SSR markup, accessibility, and zero-fetch assertions using the real component.

### Explicitly unchanged

- `src/app/(dashboard)/dashboard/providers/[id]/page.js` keeps its normal `/api/providers` load and receives no plan state or `/api/usage` call.
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/` remains unchanged.
- `src/app/api/usage/[connectionId]/route.js` and all persisted subscription behavior remain unchanged.

## Public Interface

`ConnectionRow.js` gains exactly one named export.

```js
export function getPersistedCodexPlan(connection) {
  // string | null
}
```

Its complete contract is this.

```js
getPersistedCodexPlan({
  provider: "codex",
  providerSpecificData: {
    codexSubscriptionPlan: " Pro ",
    chatgptPlanType: "Plus",
  },
}) === "Pro"

getPersistedCodexPlan({
  provider: "codex",
  providerSpecificData: {
    codexSubscriptionPlan: " unknown ",
    chatgptPlanType: " Plus ",
  },
}) === "Plus"

getPersistedCodexPlan({
  provider: "openai",
  providerSpecificData: { codexSubscriptionPlan: "Pro" },
}) === null
```

ConnectionRow derives `const codexPlan = getPersistedCodexPlan(connection)` during render. It accepts no new prop and adds no state, effect, callback, or API dependency.

---

### Task 1: Persisted Codex connection-row badge

**Files:**

- Modify: `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js:7-14,80-94,184-195,320-332`
- Create: `tests/unit/codex-plan-badge.test.js`

**Interfaces:**

- Consumes: the existing `connection` prop, Badge, `React.createElement`, and `react-dom/server`.
- Produces: `getPersistedCodexPlan(connection) -> string | null` and one optional accessible primary badge in static row markup.

- [ ] **Step 1: Write the failing persisted-data and SSR contract test**

Create `tests/unit/codex-plan-badge.test.js`. Reuse `createElement` and `renderToStaticMarkup` from `tests/unit/commandcode-zdr-ui.test.js`. Import the named helper and default component from the real ConnectionRow file. Use fixed fixtures, no-op callbacks, and a throwing fetch spy.

```js
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConnectionRow, {
  getPersistedCodexPlan,
} from "@/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js";

const nativeFetch = globalThis.fetch;
const noop = () => {};

function connection(provider, providerSpecificData = {}) {
  return {
    id: "connection-1",
    provider,
    authType: "oauth",
    name: "Account",
    priority: 1,
    isActive: true,
    providerSpecificData,
  };
}

function renderRow(rowConnection) {
  return renderToStaticMarkup(createElement(ConnectionRow, {
    connection: rowConnection,
    proxyPools: [],
    isOAuth: true,
    isFirst: true,
    isLast: true,
    onMoveUp: noop,
    onMoveDown: noop,
    onToggleActive: noop,
    onUpdateProxy: noop,
    onEdit: noop,
    onDelete: noop,
  }));
}

afterEach(() => {
  globalThis.fetch = nativeFetch;
});

describe("Codex persisted plan badge", () => {
  it("prefers the persisted Codex plan and falls back from unusable data", () => {
    expect(getPersistedCodexPlan(connection("codex", {
      codexSubscriptionPlan: " Pro ",
      chatgptPlanType: "Plus",
    }))).toBe("Pro");
    expect(getPersistedCodexPlan(connection("codex", {
      codexSubscriptionPlan: " unknown ",
      chatgptPlanType: " Plus ",
    }))).toBe("Plus");
  });

  it("returns no label for unusable plans or non-Codex connections", () => {
    expect(getPersistedCodexPlan(connection("codex", {
      codexSubscriptionPlan: " ",
      chatgptPlanType: "UNKNOWN",
    }))).toBeNull();
    expect(getPersistedCodexPlan(connection("openai", {
      codexSubscriptionPlan: "Pro",
      chatgptPlanType: "Plus",
    }))).toBeNull();
  });

  it("renders the accessible persisted badge without fetching", () => {
    const fetchSpy = vi.fn(() => { throw new Error("render must not fetch"); });
    globalThis.fetch = fetchSpy;
    const markup = renderRow(connection("codex", {
      codexSubscriptionPlan: " Pro ",
      chatgptPlanType: "Plus",
    }));

    expect(markup).toContain("Pro");
    expect(markup).toContain("Codex subscription plan");
    expect(markup).toContain("sr-only");
    expect(markup).toContain("bg-brand-500/10");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("omits the badge for a non-Codex row without fetching", () => {
    const fetchSpy = vi.fn(() => { throw new Error("render must not fetch"); });
    globalThis.fetch = fetchSpy;
    const markup = renderRow(connection("openai", {
      codexSubscriptionPlan: "Pro",
      chatgptPlanType: "Plus",
    }));

    expect(markup).not.toContain("Codex subscription plan");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

Run from `tests/`.

```bash
npx vitest run --config vitest.config.js unit/codex-plan-badge.test.js
```

Expected RED is an import failure because ConnectionRow has no named `getPersistedCodexPlan` export. Preserve the output before any production edit.

- [ ] **Step 2: Add the smallest pure resolver and accessible badge**

After `HOT_RELOAD_BADGE_VARIANTS` in ConnectionRow, add this exact pure resolver.

```js
export function getPersistedCodexPlan(connection) {
  if (connection?.provider !== "codex") return null;

  const candidates = [
    connection.providerSpecificData?.codexSubscriptionPlan,
    connection.providerSpecificData?.chatgptPlanType,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const plan = candidate.trim();
    if (plan && plan.toLowerCase() !== "unknown") return plan;
  }
  return null;
}
```

Immediately after `secondaryDisplayName`, add:

```js
const codexPlan = getPersistedCodexPlan(connection);
```

In the current status-badge group, immediately after the auth badge, add:

```jsx
{codexPlan && (
  <Badge variant="primary" size="sm">
    <span className="sr-only">Codex subscription plan </span>
    {codexPlan}
  </Badge>
)}
```

Extend only the existing `connection` PropTypes shape with optional
`provider` and `providerSpecificData`. The nested shape contains optional
string `codexSubscriptionPlan` and `chatgptPlanType`. Keep all existing props
and markup unchanged.

- [ ] **Step 3: Prove the focused test turns green**

Run the same command.

```bash
npx vitest run --config vitest.config.js unit/codex-plan-badge.test.js
```

Expected GREEN is four passing tests. It proves trimmed precedence, fallback,
invalid suppression, non-Codex suppression, primary static markup, hidden
accessibility text, and zero fetch calls during both SSR renders.

- [ ] **Step 4: Run adjacent verification and enforce scope**

Run focused feature and persisted-subscription coverage from `tests/`.

```bash
npx vitest run --config vitest.config.js \
  unit/codex-plan-badge.test.js \
  unit/codex-subscription-ui.test.js \
  unit/codex-subscription-route.test.js
```

Run lint from the repository root.

```bash
npx eslint \
  "src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js" \
  tests/unit/codex-plan-badge.test.js
```

Then enforce the file and no-network contract.

```bash
git diff --check
git diff --name-only
git diff -- \
  "src/app/(dashboard)/dashboard/providers/[id]/page.js" \
  "src/app/(dashboard)/dashboard/usage/components/ProviderLimits" \
  "src/app/api/usage"
rg -n "/api/usage|fetch\\(" \
  "src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js"
git status --short
```

Expected scope is exactly the row and new test. The prohibited-file diff is
empty. ConnectionRow has no `fetch(` or `/api/usage` match. If another file
changed, do not stage it. Classify the concurrent or generated change and report
it to the lead.

- [ ] **Step 5: Commit, push, and verify only the approved paths**

Stage the exact feature files, verify the staged patch, create one conventional
commit, and verify local HEAD advanced.

```bash
git add \
  "src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js" \
  tests/unit/codex-plan-badge.test.js
git diff --cached --check
git diff --cached --name-only
git commit -m "feat(dashboard): show persisted Codex plan badge"
git log --oneline -1
git status --short
```

After that scope is clean and no CI run for this branch is pending, push once and
verify the fork's explicit branch ref.

```bash
git push origin integration/task8-pr3210
git ls-remote origin refs/heads/integration/task8-pr3210
git rev-parse HEAD
git status --short --branch
```

The `ls-remote` object ID and HEAD object ID must match. Do not create a pull
request, mutate canonical, or make a second push for this CI cycle.

## Plan Self-Review

Task 1 covers every approved requirement. It implements the exact persisted
precedence, invalid-value policy, Codex-only behavior, primary accessible
display, and zero-fetch SSR contract. It names the only two allowed
implementation files, excludes the page, API, and quota component, and includes
complete test and implementation code. Exported names, fields, commands, and
expected outcomes are consistent. There is no placeholder or deferred decision.

