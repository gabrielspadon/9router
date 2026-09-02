# TokenProxy work order

The record of what this repository has committed to, and of what is deliberately
out of scope. It is forward-looking only. Predecessor lane ledgers, PR triage
queues, and preparation-run scratch are not reconstructed here: the predecessor
checkout remains read-only evidence and is not this repository's history.

## Baseline

TokenProxy 0.1.0. The identity is frozen in
`tracking/tokenproxy-brand-contract.json` and every field in it is a hard
constraint, not a default. The cutover that produced it is recorded in
`tracking/tokenproxy-brand-cutover.json`, the capability surface it had to
preserve in `tracking/tokenproxy-capability-baseline.csv`, and the payload it
was computed over in `tracking/tokenproxy-cutover-payload.sha256`.

`predecessorCompatibility` is `none` and `predecessorStateImport` is
`forbidden`. Nothing in this repository reads a predecessor state directory,
installs a predecessor package name, checks a predecessor update feed, or
treats a predecessor database as an import source. Two committed checks hold
that line and both must stay at zero findings:

    .unlazy-receipts/residual-scan.sh        RESIDUAL_COUNT=0
    .unlazy-receipts/verify-identity-surfaces.sh   ALL_SURFACES_RENAMED

## Lead-only paths

These carry routing, persistence, or public contract. A change to any of them
is made by the repository owner, never as a side effect of feature work.

    src/sse/handlers/chat.js
    open-sse/handlers/chatCore.js
    open-sse/executors/**
    open-sse/services/model.js
    open-sse/providers/registry/index.js
    open-sse/config/**
    src/lib/db/migrations/**
    src/lib/db/repos/**
    src/app/api/**
    tests/__baseline__/**
    tracking/**

## Standing operational constraints

Production runs on 127.0.0.1:20128 and is never deployed to, restarted, or
stopped as part of development. Source changes are verified on an isolated
instance first, on a port the host has free, with its own `DATA_DIR`:

    PORT=<free port> DATA_DIR=/tmp/tokenproxy-test-data-<port> scripts/dev-test-server.sh up
    SMOKE_BASE=http://localhost:<port> node scripts/smoke-test.mjs
    PORT=<free port> scripts/dev-test-server.sh down

A listener this repository did not start is never killed to free a port. Pick
another port instead.

The test suite is not green on a plain checkout and is not meant to be. A
regression verdict comes from `tests/__baseline__/verify-no-regression.mjs`
against the known-fail catalogue, never from a raw red count.

## Open

Nothing. The next entry is written when work is committed to, not when it is
considered.
