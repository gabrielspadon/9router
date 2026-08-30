# Kiro Root Schema Normalization Design

## Status

Approved approach A, ready for implementation planning.

## Goal

Make OpenAI and Claude tool definitions acceptable to Kiro when their input
schemas use composition at the schema root. The adaptation will replace
root-level composition with one deterministic object schema while retaining as
much inline field information as Kiro can consume.

This is a compatibility transform, not a general JSON Schema compiler. It
must be clone-safe, deterministic, permissive where the source cannot be
represented exactly, and shared by both existing Kiro request translators.

## Current Behavior

Both `openai-to-kiro.js` and the direct `claude-to-kiro.js` route call
`normalizeKiroToolSpecs` in
`open-sse/translator/concerns/kiroConversation.js`. The current root helper
deep-cleans the source, forces `type` to `object`, creates an empty
`properties` map when needed, and prunes invalid `required` entries. It leaves
root `allOf`, `oneOf`, and `anyOf` intact.

Kiro rejects those root combinators even when the source schema is otherwise
valid. The submitted upstream patch consumes one composition layer, but it
loses properties in recursively wrapped `allOf` branches and drops every
alternative requirement. The adaptation therefore needs one explicit
recursive root policy rather than a one-level merge.

## Architecture

The implementation remains inside
`open-sse/translator/concerns/kiroConversation.js`. No translator-specific
normalization will be added.

```text
OpenAI function.parameters ─┐
                            ├─ normalizeKiroToolSpecs
Claude tool.input_schema ───┘          │
                                       ▼
                            cleanSchemaValue
                            new deep-cleaned tree
                                       │
                                       ▼
                            normalizeRootSchema
                            recursive root collector
                                       │
                                       ▼
                            Kiro inputSchema.json
```

`cleanSchemaValue` owns clone-safe recursive sanitation. The root normalizer
owns only the lossy conversion from root composition to an object property
map. A small internal collector may represent its intermediate result as
separate root keywords, ordered properties, ordered local definitions, and
ordered required names. The collector is not exported and does not change the
public return shape of `normalizeKiroToolSpecs`.

The collector traverses only schemas that participate in root composition. It
does not recursively flatten schemas below `properties`, `items`, `$defs`, or
other nested schema-bearing keywords.

## Sanitization Contract

Sanitation creates new arrays and objects throughout the schema. The result
must share no mutable object or array reference with the caller, and neither
translator may mutate the supplied tool definition.

The following unsupported keys are removed at every depth.

- `additionalProperties`
- `$schema`
- `$id`
- `examples`
- `default`
- `title`

An empty `required` array is removed. Other useful validation and annotation
keywords remain unchanged, including `description`, `enum`, `const`,
`format`, numeric and string bounds, `items`, `$defs`, `definitions`, and
`$ref` under the policy below. Nested `allOf`, `oneOf`, and `anyOf` remain
unchanged unless their containing schema is being traversed as part of the
root composition.

Own enumerable property names are data, not object-prototype operations. The
implementation should use a `Map`, `Object.fromEntries`, or an equivalent safe
construction when collecting property names so a valid field such as
`__proto__` is preserved as an own schema property.

## Exact Root Semantics

### Base object

Null, primitive, array, and otherwise non-object inputs normalize to
`{ type: "object", properties: {} }`. A valid object is sanitized first.

The output always has `type: "object"`. A valid root `properties` object is
retained. A missing, null, primitive, or array-valued `properties` member
becomes an empty object. Root keywords other than composition keywords,
`type`, `properties`, and `required` survive sanitation unchanged.

Root-owned properties enter the ordered property accumulator first. Valid
root `required` names enter the ordered requirement accumulator, but no
requirement is emitted until the complete root property union is known.

### Recursive `allOf`

Each object branch in a root `allOf` is collected recursively in array order.
Its own properties are visited before its nested composition. Nested `allOf`
wrappers are therefore folded at any depth reachable through root
composition.

Properties from every branch are added to the root property union. Valid
string entries from every branch `required` array are unioned because every
`allOf` branch applies. The union is filtered against the final property map,
not against an individual branch. This preserves a requirement declared in
one branch for a property declared at the root or in another `allOf` branch.

Non-object branch values are ignored. Branch-level keywords other than
`properties`, `required`, `$defs`, `definitions`, and recursively consumed
composition do not move to the root because their combined meaning cannot be
represented safely without the rejected root combinator. Nested keywords
inside a collected property schema remain intact.

### Root `oneOf` and `anyOf`

Root `oneOf` and `anyOf` use the same permissive approximation. Each valid
object branch is recursively collected as an object fragment.

- The output property map is the union of properties visible in every viable
  branch.
- The requirement contribution is the intersection of valid required names
  across every viable branch in that alternative group.
- An empty object branch is viable. Its empty requirement set makes the group
  requirement intersection empty.
- Invalid non-object branch values are skipped. A group with no viable object
  branches contributes no properties or requirements.
- A group with one viable branch contributes that branch's known properties
  and requirements.

If the root contains both `oneOf` and `anyOf`, each group remains a condition
on the source schema. Their property unions are accumulated, and their
separate common-required intersections are unioned into the root requirement
set. An alternative nested inside an `allOf` branch is approximated first,
then its common-required result participates in the enclosing `allOf` union.

The emitted schema contains no root `allOf`, `oneOf`, or `anyOf` key after this
process.

### Property conflicts

Conflict resolution is deterministic first-writer-wins. Property and local
definition entries are visited in this order.

1. Explicit root properties
2. Recursive `allOf` branches from left to right
3. Recursive `oneOf` branches from left to right
4. Recursive `anyOf` branches from left to right

Each branch visits its own properties and local definitions before its nested
composition, using the same order recursively. A later identical definition
is harmless. A later different definition does not replace or merge the first
definition.

This policy gives explicit root intent precedence and avoids inventing an
intersection or union that Kiro may interpret differently. It is deliberately
permissive and lossy. The normalizer does not throw on conflicts and does not
synthesize a new nested combinator to represent them.

### Required output

Required names preserve first-seen order. Duplicate and non-string entries are
removed. After all property and requirement contributions are collected, a
name is retained only when the final property map owns that name. The
`required` key is omitted when no names survive.

Alternative intersections preserve the first viable branch's requirement
order and remove any name absent from a later viable branch. An opaque
alternative branch under the `$ref` policy below has no known requirements and
therefore prevents the normalizer from claiming that any field is common to
all alternatives.

## `$ref` Policy

The normalizer does not resolve, fetch, inline, or validate references.
Reference resolution would require draft selection, URI scope, cycle handling,
and external document access that are outside this compatibility change.

A root schema's own `$ref`, `$defs`, and `definitions` survive sanitation and
remain alongside the forced object shape. A `$ref` nested inside a property
schema is also preserved exactly. Local `$defs` and `definitions` maps from
consumed root-composition branches are lifted into the corresponding root map
so a collected property does not lose its local fragment target. Their entries
use the same root-first, depth-first, first-writer conflict policy as property
entries and are deep-cloned and sanitized.

A `$ref`-only branch inside a consumed root combinator has no inspectable
inline properties or required names. It contributes no merge data. For
`oneOf` or `anyOf`, it is still a viable opaque branch and is treated as having
an empty known-required set. The branch reference is not lifted to the root,
because doing so would change which alternatives or conjunctions it governs.
If a referenced branch also declares inline sibling properties or required
names, only those inline contributions are collected.

This policy is intentionally conservative. It avoids erasing inline fields or
overstating required fields while documenting that a consumed reference-backed
branch cannot be approximated beyond its visible siblings.

## Error and Compatibility Behavior

For JSON-compatible request bodies, normalization is total and does not add a
new user-visible error path. Malformed root shapes and malformed composition
members fall back or are skipped according to the rules above. Schema
conflicts are approximated rather than rejected.

Circular objects, functions, symbols, `BigInt`, and other non-JSON values are
outside the HTTP request contract. This change does not add a general-purpose
serializer or new executor error mapping for them.

Schemas without root composition retain their current behavior except for the
expanded unsupported-key stripping. Tool naming, description limits,
conversation canonicalization, tool-use/result integrity, and Kiro wire
construction remain unchanged.

Repeated normalization of already normalized JSON-compatible output must be
idempotent. Normalizing one tool must not affect another tool definition or a
later retry that reuses the original request body.

## Testing Strategy

Implementation follows strict test-driven development in a new focused test
file, expected at `tests/unit/kiro-schema-normalization.test.js`. Tests first
run red against the existing root helper, then green after the smallest shared
normalizer change.

### Normalizer cases

1. Preserve explicit root properties and current no-combinator behavior.
2. Fold a root `allOf` whose branch contains another `allOf`.
3. Union `allOf` requirements, including a name whose property is declared in
   another branch, and prune only names absent from the final property map.
4. Union `oneOf` properties while retaining only requirements common to every
   viable branch.
5. Apply the same common-required rule to `anyOf`, including an empty branch
   that clears the intersection.
6. Cover mixed `allOf`, `oneOf`, and `anyOf` wrappers and verify the fixed
   traversal order.
7. Prove root-first and branch-order first-writer conflict behavior with
   different schemas for the same property.
8. Preserve nested property combinators structurally apart from documented
   recursive sanitation.
9. Strip every unsupported key at the root, inside a property, inside an array,
   and inside local definitions.
10. Exercise direct root references, nested property references, branch-local
    definition lifting, a reference-only `allOf` branch, and an opaque
    alternative branch.
11. Skip malformed branches and fall back safely for null, primitives, arrays,
    invalid properties, and invalid required entries.
12. Preserve property names with object-prototype significance as own keys.
13. Prove deep clone safety, deterministic output, and idempotence.

### Translation-path cases

Use the real exported request translators rather than only handcrafted helper
calls.

- An OpenAI `function.parameters` schema with recursive root composition
  reaches the Kiro current message as the expected normalized
  `inputSchema.json`.
- A Claude `input_schema` with the same logical shape produces the same Kiro
  schema through the direct `claude:kiro` route.
- The caller-owned OpenAI and Claude request bodies remain byte-identical after
  translation.

Existing Kiro conversation and tool-integrity tests remain unchanged and guard
the shared call site.

## Scope and Ownership

Implementation ownership is limited to these paths.

- `open-sse/translator/concerns/kiroConversation.js`
- `tests/unit/kiro-schema-normalization.test.js`

An existing focused test may be adjusted only if its assertion directly
conflicts with the approved semantics. No other production file is needed
because OpenAI and Claude already share `normalizeKiroToolSpecs`.

## Exclusions

- No Kiro payload-size guard, shrinking, history trimming, image resizing, or
  image dependency
- No changes to `package.json`, lockfiles, Kiro constants, or executors
- No retry, endpoint fallback, account fallback, cooldown, or error-mapping
  change
- No change to conversation canonicalization or tool-use/result repair
- No general JSON Schema validation, external `$ref` resolution, or draft
  conversion
- No flattening of combinators nested inside property or item schemas
- No change to non-Kiro providers or response translation
- No wholesale integration of upstream PR 3625

The separately audited payload-degradation work must remain a different design,
plan, implementation, and commit series.

## Verification Gates

The implementation is complete only when all applicable gates below have
fresh receipts.

1. The focused schema tests fail for the intended missing behavior before the
   production change and pass afterward.
2. From `tests/`, run
   `npx vitest run --config vitest.config.js unit/kiro-schema-normalization.test.js`.
3. From `tests/`, run
   `npx vitest run --config vitest.config.js unit/kiro-conversation-canonicalization.test.js unit/openai-to-kiro.test.js unit/kiro-usage-and-tool-integrity.test.js`.
4. Run the repository no-regression verifier for the broader suite and account
   for catalogued baseline failures rather than calling a raw red suite green.
5. Run ESLint on the changed production and test files.
6. Run `npm run build` from the repository root.
7. Run `git diff --check`, confirm only the bounded implementation and test
   paths changed, and verify no payload-degradation file or dependency entered
   the diff.

No live Kiro credential is required for this pure request-normalization change.
