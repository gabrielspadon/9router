# Kiro Root Schema Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize recursively composed Kiro tool-input roots into deterministic object schemas without mutating OpenAI or Claude requests.

**Architecture:** Keep one private recursive root collector beside `normalizeKiroToolSpecs` in `kiroConversation.js`. It deep-sanitizes a cloned JSON-compatible schema, unions root properties, recursively folds `allOf`, approximates `oneOf` and `anyOf` with property unions and common-required intersections, and preserves nested property schemas and the documented `$ref` boundary. Both existing Kiro request translators continue using the unchanged exported interface.

**Tech Stack:** Plain JavaScript ESM, Vitest 4, Node.js 25, ESLint 9, Next.js 16.

## Global Constraints

- Start from the PR3625 schema branch descended from `4e505779d9c66fdca0191d87db863bba86e3f466` with design commit `d51847abb74ea1453af8ef5841db018f36138bd0` present.
- The later PR3629 integration changes `open-sse/utils/stream.js` and its focused test only. It has no overlap with this plan and must not be folded into the implementation commit.
- Modify only `open-sse/translator/concerns/kiroConversation.js` and create only `tests/unit/kiro-schema-normalization.test.js`.
- Keep `normalizeKiroToolSpecs(tools)` and its `{ specs, nameMap }` return contract unchanged.
- Use no new package, lockfile entry, network call, executor hook, configuration field, or exported helper.
- Remove `additionalProperties`, `$schema`, `$id`, `examples`, `default`, and `title` recursively. Remove empty `required` arrays.
- Always emit a root object schema. Preserve explicit root properties and use root, recursive `allOf`, `oneOf`, then `anyOf` as the fixed first-writer merge order.
- Union `allOf` requirements. For each `oneOf` or `anyOf` group, intersect requirements across every viable object branch, then union that group result into the enclosing fragment.
- Filter requirements only after the final root property union is complete. Keep first-seen order and omit `required` when empty.
- Preserve combinators and `$ref` values nested inside property schemas. Never resolve, fetch, inline, or validate a reference.
- Preserve a root-owned `$ref`. Do not lift a branch `$ref` out of a consumed root combinator.
- Lift branch-local `$defs` and `definitions` maps with the same root-first, depth-first, first-writer policy so collected property references retain their targets.
- Treat a `$ref`-only alternative as a viable branch with no known requirements. Treat non-object combinator members as invalid and skip them.
- Keep payload sizing, shrinking, history trimming, images, dependencies, Kiro executors, retry behavior, account fallback, cooldowns, and error mapping out of scope.
- Keep conversation canonicalization and tool-use/result integrity behavior unchanged.
- Follow strict TDD. Capture the focused RED result before editing production code, then make the smallest implementation that turns that same command green.

---

### Task 1: Normalize composed Kiro tool-schema roots through the shared translator concern

**Files:**
- Modify: `open-sse/translator/concerns/kiroConversation.js:50-76`
- Create: `tests/unit/kiro-schema-normalization.test.js`

**Interfaces:**
- Consumes: `normalizeKiroToolSpecs(tools: unknown): { specs: Array<object>, nameMap: Map<string, string> }`, `openaiToKiroRequest(model: string, body: object, stream: boolean, options: object): object`, and `claudeToKiroRequest(model: string, body: object, stream: boolean, options: object): object`.
- Produces: the same `normalizeKiroToolSpecs` interface, with each `specs[n].toolSpecification.inputSchema.json` containing a deep-cloned normalized root object.
- Produces privately: `isSchemaObject(value): boolean`, `cleanSchemaValue(value): unknown`, `collectRootFragment(schema: object): RootFragment`, and `normalizeRootSchema(schema: unknown): object`.
- Uses private `RootFragment` shape: `{ properties: Map<string, unknown>, required: string[], defs: Map<string, unknown>, definitions: Map<string, unknown>, sawDefs: boolean, sawDefinitions: boolean }`.

- [ ] **Step 1: Create the focused regression suite with concrete root, conflict, reference, malformed-input, clone, and translator fixtures**

Create `tests/unit/kiro-schema-normalization.test.js` with these imports and helpers.

```js
import { describe, expect, it } from "vitest";
import { normalizeKiroToolSpecs } from "../../open-sse/translator/concerns/kiroConversation.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";

const MODEL = "claude-sonnet-4.6";

function specSchema(schema) {
  const { specs } = normalizeKiroToolSpecs([{
    name: "demo",
    description: "Demo tool",
    input_schema: schema,
  }]);
  expect(specs).toHaveLength(1);
  return specs[0].toolSpecification.inputSchema.json;
}

function translatedSchema(result) {
  return result.conversationState.currentMessage.userInputMessage
    .userInputMessageContext.tools[0].toolSpecification.inputSchema.json;
}

function schemaProperties(entries) {
  return Object.fromEntries(entries);
}
```

Use this recursive fixture. It exercises the exact traversal order, cross-branch `allOf` requirements, alternative intersections, recursive sanitation, nested-combinator preservation, branch-local definition lifting, and prototype-significant property names.

```js
function recursiveSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "strip root title",
    type: "object",
    $defs: {
      RootValue: { type: "string", title: "strip definition title", $id: "urn:root" },
    },
    properties: schemaProperties([
      ["rootOnly", { type: "string", default: "strip default" }],
      ["conflict", { type: "string" }],
      ["commonOne", { type: "string" }],
      ["commonAny", { type: "string" }],
      ["nested", { anyOf: [{ type: "string", title: "strip nested title" }, { type: "number" }] }],
      ["__proto__", { type: "string" }],
    ]),
    required: ["rootOnly", "ghost", 42],
    allOf: [{
      properties: {
        nestedAll: { type: "number" },
        branchConflict: { type: "string" },
      },
      required: ["nestedAll", "cross"],
      allOf: [{
        $defs: {
          BranchValue: { type: "integer", examples: [1] },
        },
        properties: {
          cross: { type: "integer" },
          fromDef: { $ref: "#/$defs/BranchValue" },
          conflict: { type: "boolean" },
          branchConflict: { type: "boolean" },
        },
        required: ["cross"],
      }],
    }],
    oneOf: [
      {
        properties: {
          variantA: { type: "string" },
          conflict: { type: "number" },
          alternativeConflict: { const: "oneOf" },
        },
        required: ["commonOne", "variantA"],
      },
      {
        properties: { variantB: { type: "number" } },
        required: ["commonOne", "variantB"],
      },
    ],
    anyOf: [
      {
        properties: {
          optionalA: { type: "boolean" },
          alternativeConflict: { const: "anyOf" },
        },
        required: ["commonAny", "optionalA"],
      },
      {
        properties: { optionalB: { type: "string" } },
        required: ["commonAny", "optionalB"],
      },
    ],
    additionalProperties: false,
  };
}
```

Add the following tests. Keep the property-order assertion because insertion order is part of the deterministic conflict policy.

```js
describe("Kiro root schema normalization", () => {
  it("preserves supported non-composition keywords and removes empty required", () => {
    expect(specSchema({
      description: "keep root description",
      minProperties: 1,
      properties: {
        value: {
          type: "string",
          description: "keep property description",
          enum: ["a", "b"],
          title: "strip property title",
        },
      },
      required: [],
    })).toEqual({
      description: "keep root description",
      minProperties: 1,
      type: "object",
      properties: {
        value: {
          type: "string",
          description: "keep property description",
          enum: ["a", "b"],
        },
      },
    });
  });

  it("recursively folds root composition with deterministic properties and requirements", () => {
    const out = specSchema(recursiveSchema());

    expect(Object.keys(out.properties)).toEqual([
      "rootOnly", "conflict", "commonOne", "commonAny", "nested", "__proto__",
      "nestedAll", "branchConflict", "cross", "fromDef", "variantA",
      "alternativeConflict", "variantB", "optionalA", "optionalB",
    ]);
    expect(out.required).toEqual([
      "rootOnly", "nestedAll", "cross", "commonOne", "commonAny",
    ]);
    expect(out.properties.conflict).toEqual({ type: "string" });
    expect(out.properties.branchConflict).toEqual({ type: "string" });
    expect(out.properties.alternativeConflict).toEqual({ const: "oneOf" });
    expect(out.properties.nested).toEqual({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
    expect(out.properties.fromDef).toEqual({ $ref: "#/$defs/BranchValue" });
    expect(out.$defs).toEqual({
      RootValue: { type: "string" },
      BranchValue: { type: "integer" },
    });
    expect(out).not.toHaveProperty("allOf");
    expect(out).not.toHaveProperty("oneOf");
    expect(out).not.toHaveProperty("anyOf");
    expect(JSON.stringify(out)).not.toMatch(/additionalProperties|\$schema|\$id|examples|default|title/);
    expect(Object.hasOwn(out.properties, "__proto__")).toBe(true);
  });

  it("counts empty and reference-only alternatives when intersecting required names", () => {
    const withEmpty = specSchema({
      properties: { common: { type: "string" }, branch: { type: "number" } },
      oneOf: [
        { properties: { branch: { type: "number" } }, required: ["common", "branch"] },
        {},
      ],
    });
    const withReference = specSchema({
      $defs: { Other: { type: "object", properties: { other: { type: "string" } } } },
      properties: { common: { type: "string" } },
      anyOf: [
        { required: ["common"] },
        { $ref: "#/$defs/Other" },
      ],
    });

    expect(withEmpty.required).toBeUndefined();
    expect(withReference.required).toBeUndefined();
    expect(withReference).not.toHaveProperty("$ref");
    expect(withReference.$defs.Other.properties.other).toEqual({ type: "string" });
  });

  it("preserves a root reference but never lifts a consumed branch reference", () => {
    const out = specSchema({
      $ref: "#/$defs/Input",
      $defs: { Input: { type: "object", properties: { root: { type: "string" } } } },
      allOf: [
        { $ref: "#/$defs/Input" },
        {
          definitions: { Local: { type: "number", title: "strip" } },
          properties: { local: { $ref: "#/definitions/Local" } },
        },
      ],
    });

    expect(out.$ref).toBe("#/$defs/Input");
    expect(out.properties.local).toEqual({ $ref: "#/definitions/Local" });
    expect(out.definitions).toEqual({ Local: { type: "number" } });
  });

  it.each([null, "not-a-schema", 42, [], true])(
    "falls back to an empty object schema for %j",
    (source) => {
      expect(specSchema(source)).toEqual({ type: "object", properties: {} });
    },
  );

  it("skips invalid combinator members and prunes malformed required entries", () => {
    expect(specSchema({
      properties: { kept: { type: "string" } },
      required: ["kept", "missing", 7, "kept"],
      allOf: [null, "bad", 9, [], { required: ["alsoMissing"] }],
      oneOf: [false, { properties: { alternative: { type: "number" } } }],
    })).toEqual({
      type: "object",
      properties: { kept: { type: "string" }, alternative: { type: "number" } },
      required: ["kept"],
    });
  });

  it("is deterministic, idempotent, and shares no mutable schema references", () => {
    const source = recursiveSchema();
    const before = JSON.stringify(source);
    const first = specSchema(source);
    const second = specSchema(source);
    const normalizedAgain = specSchema(first);

    expect(first).toEqual(second);
    expect(normalizedAgain).toEqual(first);
    expect(JSON.stringify(source)).toBe(before);
    first.properties.nested.anyOf[0].type = "boolean";
    expect(source.properties.nested.anyOf[0].type).toBe("string");
  });

  it("normalizes the same schema through both real request translators", () => {
    const schema = recursiveSchema();
    const openaiBody = {
      messages: [{ role: "user", content: "run the demo" }],
      tools: [{
        type: "function",
        function: { name: "demo", description: "Demo tool", parameters: schema },
      }],
    };
    const claudeBody = {
      messages: [{ role: "user", content: "run the demo" }],
      tools: [{ name: "demo", description: "Demo tool", input_schema: schema }],
    };
    const before = JSON.stringify({ openaiBody, claudeBody });

    const openai = translatedSchema(openaiToKiroRequest(MODEL, openaiBody, true, {}));
    const claude = translatedSchema(claudeToKiroRequest(MODEL, claudeBody, true, {}));

    expect(openai).toEqual(specSchema(schema));
    expect(claude).toEqual(openai);
    expect(JSON.stringify({ openaiBody, claudeBody })).toBe(before);
  });
});
```

- [ ] **Step 2: Run the focused suite and preserve the RED receipt**

Run from `tests/`.

```bash
npx vitest run --config vitest.config.js unit/kiro-schema-normalization.test.js
```

Expected result is a nonzero exit. The recursive case must show that current output still contains root combinators and lacks collected fields such as `cross`; the sanitation assertions must show that keys such as `title` remain. If the suite fails only because the fixture cannot reach the shared translator path, correct the test harness before touching production code and run RED again.

- [ ] **Step 3: Implement the minimal clone-safe recursive root collector**

In `open-sse/translator/concerns/kiroConversation.js`, replace only the schema-cleaning and root-normalization block at current lines 50 through 76. Keep `normalizeKiroToolSpecs` and every conversation helper unchanged.

Use these constants and helper contracts.

```js
const STRIPPED_SCHEMA_KEYS = new Set([
  "additionalProperties", "$schema", "$id", "examples", "default", "title",
]);
const ROOT_COMBINATORS = ["allOf", "oneOf", "anyOf"];

function isSchemaObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanSchemaValue(value) {
  if (Array.isArray(value)) return value.map(cleanSchemaValue);
  if (!isSchemaObject(value)) return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    if (STRIPPED_SCHEMA_KEYS.has(key)) return [];
    if (key === "required" && Array.isArray(child) && child.length === 0) return [];
    return [[key, cleanSchemaValue(child)]];
  }));
}
```

Implement `collectRootFragment` with the following complete control flow. Helper names may remain private, but their inputs, outputs, and ordering must match this pseudocode.

```js
function emptyFragment() {
  return {
    properties: new Map(),
    required: [],
    defs: new Map(),
    definitions: new Map(),
    sawDefs: false,
    sawDefinitions: false,
  };
}

function addFirst(target, source) {
  if (!isSchemaObject(source)) return;
  for (const [name, value] of Object.entries(source)) {
    if (!target.has(name)) target.set(name, value);
  }
}

function addRequired(target, names) {
  if (!Array.isArray(names)) return;
  for (const name of names) {
    if (typeof name === "string" && !target.includes(name)) target.push(name);
  }
}

function mergeShape(target, source) {
  addFirst(target.properties, Object.fromEntries(source.properties));
  addFirst(target.defs, Object.fromEntries(source.defs));
  addFirst(target.definitions, Object.fromEntries(source.definitions));
  target.sawDefs ||= source.sawDefs;
  target.sawDefinitions ||= source.sawDefinitions;
}

function commonRequired(fragments) {
  if (fragments.length === 0) return [];
  const later = fragments.slice(1).map((item) => new Set(item.required));
  return fragments[0].required.filter((name) => later.every((set) => set.has(name)));
}

function validBranches(value) {
  return Array.isArray(value) ? value.filter(isSchemaObject) : [];
}

function collectRootFragment(schema) {
  const fragment = emptyFragment();
  addFirst(fragment.properties, schema.properties);
  addRequired(fragment.required, schema.required);

  if (isSchemaObject(schema.$defs)) {
    fragment.sawDefs = true;
    addFirst(fragment.defs, schema.$defs);
  }
  if (isSchemaObject(schema.definitions)) {
    fragment.sawDefinitions = true;
    addFirst(fragment.definitions, schema.definitions);
  }

  for (const branch of validBranches(schema.allOf)) {
    const child = collectRootFragment(branch);
    mergeShape(fragment, child);
    addRequired(fragment.required, child.required);
  }

  for (const keyword of ["oneOf", "anyOf"]) {
    const alternatives = validBranches(schema[keyword]).map(collectRootFragment);
    for (const child of alternatives) mergeShape(fragment, child);
    addRequired(fragment.required, commonRequired(alternatives));
  }

  return fragment;
}
```

Finish `normalizeRootSchema` with a sanitized record, preserved non-composition root keywords, reconstructed definition maps, forced object shape, and final requirement pruning.

```js
function normalizeRootSchema(schema) {
  const cleaned = cleanSchemaValue(isSchemaObject(schema) ? schema : {});
  const fragment = collectRootFragment(cleaned);
  const preserved = Object.fromEntries(Object.entries(cleaned).filter(([key, value]) => {
    if (ROOT_COMBINATORS.includes(key)) return false;
    if (["type", "properties", "required"].includes(key)) return false;
    if ((key === "$defs" || key === "definitions") && isSchemaObject(value)) return false;
    return true;
  }));
  const normalized = {
    ...preserved,
    type: "object",
    properties: Object.fromEntries(fragment.properties),
  };
  if (fragment.sawDefs && (cleaned.$defs === undefined || isSchemaObject(cleaned.$defs))) {
    normalized.$defs = Object.fromEntries(fragment.defs);
  }
  if (fragment.sawDefinitions &&
      (cleaned.definitions === undefined || isSchemaObject(cleaned.definitions))) {
    normalized.definitions = Object.fromEntries(fragment.definitions);
  }
  const required = fragment.required.filter((name) => fragment.properties.has(name));
  if (required.length > 0) normalized.required = required;
  return normalized;
}
```

Do not remove the existing general `clone` helper. Other conversation paths still use it. Do not export the new helpers.

- [ ] **Step 4: Run the exact focused command and obtain GREEN**

Run from `tests/`.

```bash
npx vitest run --config vitest.config.js unit/kiro-schema-normalization.test.js
```

Expected result is one passing file, twelve passing tests, zero failures, and zero unhandled errors. Inspect the full output rather than relying only on the process exit code.

- [ ] **Step 5: Run Kiro translation and conversation adjacency**

Run from `tests/`.

```bash
npx vitest run --config vitest.config.js unit/kiro-conversation-canonicalization.test.js unit/openai-to-kiro.test.js unit/kiro-usage-and-tool-integrity.test.js
```

Expected result is all selected files and assertions passing with no new snapshot, timeout, or unhandled-error output. Any changed conversation or tool-use/result assertion is a production regression, not a baseline exception.

- [ ] **Step 6: Run syntax, lint, whitespace, and bounded-scope gates**

Run from the repository root.

```bash
node --check open-sse/translator/concerns/kiroConversation.js
node --check tests/unit/kiro-schema-normalization.test.js
npx eslint open-sse/translator/concerns/kiroConversation.js tests/unit/kiro-schema-normalization.test.js
git diff --check
git status --short --branch
```

Expected status is one modified tracked path at `open-sse/translator/concerns/kiroConversation.js` and one untracked path at `tests/unit/kiro-schema-normalization.test.js`, with no other entry. The syntax, ESLint, and whitespace commands must exit zero.

- [ ] **Step 7: Run the full baseline-aware unit gate and production build**

Use a temporary JSON receipt so the repository remains clean. Run the first two commands from `tests/`.

```bash
task6_kiro_results=$(mktemp)
CI=1 npx vitest run --config vitest.config.js --reporter=json --outputFile="$task6_kiro_results"
node __baseline__/verify-no-regression.mjs "$task6_kiro_results"
```

The raw Vitest command may exit nonzero only for failures already catalogued by the repository. The verifier must exit zero and report no pass-to-fail regression. A missing JSON result, new failure, crash, or unhandled error is not a pass.

Return to the repository root and run the build with isolated runtime data.

```bash
task6_kiro_data_dir=$(mktemp -d)
DATA_DIR="$task6_kiro_data_dir" JWT_SECRET="task6-kiro-schema-build-secret" npm run build
```

Expected result is a zero exit from the Next.js production build and postbuild asset copy. Do not start, deploy, or restart either local 9router service.

- [ ] **Step 8: Review the implementation diff and commit the single logical change**

Run from the repository root.

```bash
git diff --check
git status --short --branch
git add open-sse/translator/concerns/kiroConversation.js tests/unit/kiro-schema-normalization.test.js
git diff --cached --check
git diff --cached --name-only
git diff --cached -- open-sse/translator/concerns/kiroConversation.js tests/unit/kiro-schema-normalization.test.js
git commit -m "fix(kiro): normalize root tool schemas"
```

The staged name list must contain exactly the two implementation-owned paths. The diff must contain no payload degradation, dependency, executor, error-mapping, stream, design, plan, or tracking change.

- [ ] **Step 9: Verify commit advancement and final cleanliness**

Run from the repository root.

```bash
git log -2 --oneline --decorate
git show --check --stat --oneline HEAD
git diff-tree --no-commit-id --name-status -r HEAD
git status --short --branch
```

Expected result is the new `fix(kiro): normalize root tool schemas` commit above the documentation commits, exactly two paths in that commit, no tracked or untracked implementation residue, and no ref, push, deployment, or service mutation.
