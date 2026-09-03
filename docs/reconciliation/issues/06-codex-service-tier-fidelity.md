# Codex service-tier fidelity

Priority: P1
Status: Partial (the alias-stripping bug is fixed; note below on the receipt and failure-direction gaps that remain)

## Current behavior

- `open-sse/config/codexFastMode.js:31` (`if (Object.prototype.hasOwnProperty.call(body, "service_tier")) return body;`) already passes an explicit client-supplied `service_tier` straight through untouched, and lines 32-39 only inject a tier (`clientServiceTier`, defaulting to `"priority"` at line 39) when the caller didn't specify one and the model is in `CODEX_SOL_FAST_MODELS`. This half of tier handling already preserves an explicit client value.
- `open-sse/executors/codex.js:737` (`if (body.service_tier === "fast") body.service_tier = "priority";`) is the compatibility-alias mapping the matrix cites. The very next line, `:738` (`if (body.service_tier && body.service_tier !== "priority") delete body.service_tier;`), is the actual defect: it deletes any tier value that survives the `fast → priority` remap and isn't literally `"priority"` — so an explicit `"default"` or `"ultrafast"` sent by a caller is stripped from the outbound Codex payload entirely, not forwarded. **Fixed**: `codex.js:743-745` now calls `normalizeCodexServiceTier` (`open-sse/config/codexFastMode.js:23`, an explicit `{"default","priority","ultrafast"}` allowlist plus the `fast→priority` alias), and `default`/`priority`/`ultrafast` all pass through byte-for-byte (confirmed by `tests/unit/reconciliation/service-tier.test.js:23`).
- The final allowlist filter (`codex.js:741-743`, `RESPONSES_API_ALLOWLIST` declared at `:48`) runs after the tier deletion, so a stripped `service_tier` never reaches the allowlist check either — it is simply gone by the time the request leaves TokenProxy.
- No receipt records which tier was actually sent outbound; `service_tier` is not among the fields captured by `src/lib/db/repos/requestDetailsRepo.js`'s persisted request shape. **Still true for a DB receipt**: `requestDetailsRepo.js` still has no `service_tier` column. What exists instead is a log line (`codex.js:477-478`, `args.log?.info?.("TIER", ...)`), not a queryable receipt field — the "Required behavior" ask for a receipt the soak step can query is only partially met.

## Required behavior

Preserve `"default"`, `"priority"`, and `"ultrafast"` exactly as supplied by the caller. Treat `"fast"` only as a compatibility alias that maps to `"priority"` (the one mapping that already works, at `codex.js:737`) — remove the blanket deletion at `:738` that currently discards every other explicit value. Record the outbound tier that was actually sent in a redacted receipt (tier value only — no prompt content, no headers) so Phase 4's soak step can verify tier distribution without replaying request bodies.

Failure direction: a `service_tier` value that is none of `"default"`, `"priority"`, `"ultrafast"`, or `"fast"` is rejected as a 4xx at the point the request enters TokenProxy (deterministic, not a silent drop deep in the executor) rather than being deleted and forwarded tier-less, since a tier-less request silently changes provider billing/scheduling behavior without telling the caller. **Implemented differently**: the shipped code omits an unrecognized tier rather than rejecting the request (`codexFastMode.js:26-31`'s comment states this is deliberate — "Failure is therefore by OMISSION, never by substituting a tier the caller did not ask for"), confirmed by `service-tier.test.js:47` (`expect(outbound(tier)).not.toHaveProperty("service_tier")`) — there is no 4xx path for an unsupported tier today.

## Acceptance test

Required proof (Acceptance Tests, "Tier fidelity"): "Captured outbound Codex requests preserve `default`, `priority`, and `ultrafast` byte-for-byte. The audit receipt records the chosen tier."

Vitest translation:

- Fixture: a fake Codex executor transport that captures the exact outbound JSON body it was asked to send, without performing a network call (mirrors the existing pattern in `tests/unit/executors/`).
- Fake provider, no fake clock needed.
- Four cases, one request body each with `service_tier` set to `"default"`, `"priority"`, `"ultrafast"`, and `"fast"`: run each through `open-sse/executors/codex.js`'s body-shaping path and assert the captured outbound body's `service_tier` equals the input verbatim for the first three, and equals `"priority"` for `"fast"` — a deep-equal on the whole captured body, not just the one field, to catch the allowlist filter dropping it as a side effect.
- Fifth case: an unsupported tier value (e.g. `"bogus"`) asserted to produce a 4xx response from the request-entry point, not a silently tier-less outbound body.
- Sixth case: after a successful `"ultrafast"` request, assert the persisted receipt (via the receipt-writing function, not a live DB) carries `service_tier: "ultrafast"` and no other request-body fields.
- Proposed file: `tests/unit/reconciliation/codex-service-tier-fidelity.test.js`.

## Blast radius

- `open-sse/executors/codex.js` — remove or narrow the `:738` deletion so it only strips genuinely unsupported values, not every non-`"priority"` one.
- Receipt-writing path (wherever `src/lib/db/repos/requestDetailsRepo.js` or a sibling receipts repo persists per-request metadata) — add the outbound `service_tier` field.
- `tests/unit/reconciliation/codex-service-tier-fidelity.test.js` — new.

DB migration: only if the tier is added to an *existing* persisted table's columns (e.g. `requestDetails`, defined at `src/lib/db/schema.js:132`) rather than a new receipts table row 04 already adds. A new column on an existing table is additive and handled by `syncSchemaFromTables` (`migrate.js:43-73`) without a `SCHEMA_VERSION` bump, since that path only strips `PRIMARY KEY`/`UNIQUE` and runs `ALTER TABLE ... ADD COLUMN` (`migrate.js:56-58`) — no versioned migration file needed for a single nullable column.
