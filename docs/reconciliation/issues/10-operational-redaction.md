# Operational redaction

Priority: P1
Status: Implemented — see correction below.

## Current behavior

Superseded: `open-sse/utils/redact.js` now exists — the exact shared module this row's Blast Radius specified — exporting `maskSensitiveHeaders`, `stripSensitiveHeaders`, `redactSecrets`, and `redactSecretsText`. Both consumers now import from it: `requestLogger.js:1` and `requestDetailsRepo.js:1` (`sanitizeHeaders` at `:127` is now just `= stripSensitiveHeaders`, the header-key-list unification this row asked for). Body redaction is field-level, not merely truncation: `requestDetailsRepo.js:148-154`'s `redactAndTruncate` calls `redactSecrets(obj)` before `truncateField`, and on a redaction failure returns `{ redacted: true, reason: "redaction failed" }` rather than the raw body — matching the "fails closed" direction this row required. The paragraphs below describe the pre-implementation state for context.

- `open-sse/utils/requestLogger.js:72` is a comment (`// Mask credentials in headers. Request logs are written to disk unredacted...`) directly above the actual function at `:75`, `function maskSensitiveHeaders(headers) {` (`:75-79`, filtering on a fixed key list: `authorization`, `x-api-key`, `api-key`, `cookie`, `token`, `secret`). This is the task's second known drift, confirmed: the behavior described (masking headers) is real, but it lives at `:75`, not `:72`.
- The same comment block states plainly that request logs are "written to disk unredacted otherwise" — header masking is the only redaction `requestLogger.js` performs; full request/response bodies pass through to disk whenever `ENABLE_REQUEST_LOGS` is on.
- `src/lib/db/repos/requestDetailsRepo.js:123` (`function sanitizeHeaders(headers) {`, `:123-129`) does the same header-masking job for the DB-backed path, on a similar but not identical key list (`authorization`, `x-api-key`, `cookie`, `token`, `api-key` — no `secret`).
- `src/lib/db/repos/requestDetailsRepo.js:176-179` is where the corresponding request/provider bodies are persisted: `request: truncateField(item.request, config.maxJsonSize)`, `providerRequest: truncateField(...)`, `providerResponse: truncateField(...)`, `response: truncateField(...)` — all four are size-truncated, none is field-redacted. A secret embedded inside a request or provider body (not a header) survives truncation and reaches the DB in full, up to the size cap.
- Bodies are captured unconditionally whenever the feature that writes them is on; there is no opt-in gate at the field level, only the size cap.

## Required behavior

Make full body capture opt-in rather than the default whenever request logging is enabled at all, bounded by an explicit retention policy, and field-redacted before persistence — not merely size-truncated. Redaction must recognize secret-shaped fields inside bodies (API keys, bearer tokens, provider credentials embedded in a request or provider-response payload), not only header names. Disable body capture entirely for validation frames (auth probes, credential-check requests) and for any frame that exists specifically to carry a secret, regardless of the opt-in setting.

Failure direction: when the redaction step itself fails (a body shape it cannot parse, an unexpected structure), the safe outcome is to drop the unredacted body rather than persist it un-redacted — a redaction failure fails closed to "log nothing for this field," never open to "log everything since we couldn't redact it."

## Acceptance test

Required proof (Acceptance Tests, "Privacy"): "Secret fixtures placed in headers, request bodies, provider bodies, stream frames, and receipts are absent from persisted logs and APIs."

Vitest translation:

- Fixture: one canary secret string (e.g. `sk-canary-TESTSECRET123`) planted in five places on a single fake request: an `Authorization` header, the client request body, the outbound provider-request body, a mid-stream SSE frame, and the resulting usage/generation receipt.
- Run the fixture through both persistence paths — `requestLogger.js`'s disk-log writer and `requestDetailsRepo.js`'s DB writer — with body capture opted in (to prove redaction works even when capture is on, not just that capture is off).
- Assert the canary string does not appear anywhere in either persisted artifact: `expect(JSON.stringify(persistedLogRecord)).not.toContain(CANARY)` and the same for the DB-repo record, plus the receipt object from row 04/07's receipt path.
- Assert header masking still works for both key-list variants (`requestLogger.js`'s five-key list and `requestDetailsRepo.js`'s current four-key list — reconciling the two lists into one shared list is in scope for this row's fix and should be asserted directly: both call sites use the same exported list).
- Negative control: a non-secret-shaped field (e.g. `model: "gpt-5"`) is asserted to survive redaction unchanged, proving the fix removes secrets specifically rather than gutting the log's usefulness.
- Proposed file: `tests/unit/reconciliation/operational-redaction.test.js`.

## Blast radius

- `open-sse/utils/requestLogger.js` — extend `maskSensitiveHeaders` (`:75-79`) into a shared redaction module and gate raw body capture behind explicit opt-in.
- `src/lib/db/repos/requestDetailsRepo.js` — replace the `:176-179` `truncateField`-only body handling with redact-then-truncate, and unify its header key list (`:123-129`) with `requestLogger.js`'s so the two paths can't drift again.
- New shared redaction module (e.g. `src/shared/utils/redact.js`) used by both.
- `tests/unit/reconciliation/operational-redaction.test.js` — new.

No DB migration. `requestDetails` (`src/lib/db/schema.js:132`) already stores `request`/`providerRequest`/`providerResponse`/`response` as text columns; this row changes what gets written into them, not their shape.
