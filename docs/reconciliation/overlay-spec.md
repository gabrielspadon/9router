# Resilience Overlay — Public Implementation Spec

Companion to `RECONCILIATION.md`. Restates the 19 behaviors recovered from the
private router-resilience overlay as an implementable specification, with no
dependency on the private extraction. Two source trees fed the private audit,
called overlay-A and overlay-B below; where they disagree this document picks
one value and states the grounds. `<legacy>` stands for the retired gateway
package name, per `RECONCILIATION.md`'s existing convention.

Each section below is independently implementable and states: trigger,
inputs, ordering/ranking rule, every constant with its unit, persisted state,
and failure direction.

---

### 1. Compound quota-window ranking

**Trigger.** Before a request needs a provider connection, or on any
configuration refresh, rank the active connections eligible for a given
provider node.

**Inputs.** The set of active connections for one provider node (2+ members;
a single-member set short-circuits with no ranking work at all). For each
connection: its quota evidence, fetched fresh (no cached usage), as a map of
window name to `{used, total, resetAt}`. A second input is the connection id
most recently pinned for that node group, used only as a tie-breaker.

**Window classification.** A window name is either GENERAL (whole-account
entitlement: session, rate-limit, hourly, daily, weekly, monthly, or annual,
with an optional parenthetical duration like `(5h)` or `(7d)`) or SCOPED
(per-model or per-feature sub-quota, tolerated and ignored for ranking). A
window matching neither vocabulary fails that one account closed; it does not
take the provider offline.

**Horizon.** Parse a parenthetical duration case-insensitively: `m`/`min` = 60
s, `h` = 3600 s, `d` = 86400 s, `w` = 604800 s, `mo`/`month` = 2,592,000 s,
`y`/`year` = 31,536,000 s. With no parenthetical, fall back on the bare name:
hourly 3600 s, daily 86400 s, weekly 604800 s, monthly 2,592,000 s,
annual/yearly 31,536,000 s, anything else 1 s.

**Validation, per-account and soft.** An account errors out of ranking (but
not out of existence) when it has zero general windows, any window is neither
general nor scoped, any general window's `used` is not a number or is
negative, `total` is not a number or is `<= 0`, or `resetAt` is not a
well-formed ISO-8601 UTC timestamp.

**Ordering, five keys in order.** 1) usable accounts (`used < total` on every
general window) before depleted ones. 2) The account's general windows sorted
by horizon descending, then compared as an array of `resetAt` values,
lexicographically — the account whose LONGEST window resets soonest sorts
first; ties fall through to the next-longest window. This is the core
invariant: burn the entitlement that is about to be wasted first, without
ever letting a short window's reset order override a longer, binding window.
3) The previous pin (cache stickiness). 4) explicit priority, lowest wins,
missing treated as unbounded. 5) original index, so the sort is total.

**Cohort gate.** Ranking degrades to the previous-pin fallback (see below)
unless every connection in the cohort produced a valid record, every record's
window shape (the set of horizon+name pairs) is identical across the cohort,
and at least one record is usable. Comparing accounts with incomparable
window shapes is worse than not ranking them.

**Persisted state.** The winning connection id and provider node become the
active route pin. Every ranked connection is retained as failover inventory
(id + provider node + a salted account-identity hash), written only after a
full ranking pass succeeds, so a failed or partial run never overwrites
last-good pin state.

**Failure direction.** FAILURE is per-account and soft everywhere except the
cohort gate. Any usage-fetch failure, malformed quota window, mismatched
cohort shape, or an all-depleted cohort routes the whole group to
"prefer the previous pin, else preserve original order" rather than aborting
the request or the refresh. Ranking never blocks on missing evidence; it
degrades to last-good stickiness.

**Conflict.** The two source trees disagree on null `resetAt` handling: one
tolerates `resetAt == null` on an untouched short window (`used == 0`,
not the longest window) and sorts it first; the other requires every general
window to carry a real timestamp and falls the whole account out of ranking
otherwise. **Resolution: require a real timestamp on every general window
(the strict reading is authoritative).** Grounds: the strict tree is the one
closer to the harness's current published state, and a ranking rule that
silently front-loads an account with no reset evidence contradicts the
"never round-robin, never spray" invariant TokenProxy's own Account
Scheduling Contract sets — an account should earn its ranking from evidence,
not from an evidence gap.

---

### 2. Account-scoped concurrency admission gate

**Trigger.** Every request that resolves to a servedModel and a connection
with an account identity, before dispatch to the provider.

**Inputs.** The served model name, the resolved connection's account-identity
hash and provider node, and the lane's configured concurrency ceiling
(`max_concurrency`, a non-negative integer read from the lane registry entry
for that model; a missing or non-positive value means UNGATED — the request
proceeds with no queueing at all).

**Gate key and ordering rule.** Slots are counted per gate object, one per
distinct `(providerNode, accountHash)` pair rather than per model name, so
every lane sharing one physical account shares one queue and one limit. The
limit is re-read on every acquire, so a live registry change widens or
narrows an existing gate without recreating it. Admission is strict FIFO:
while active count is below the limit and the queue is non-empty, waiters are
admitted in order; a waiter whose caller already disconnected or cancelled is
skipped rather than admitted.

**Constants.** 0 is the sentinel for "no limit configured" (gate skipped
entirely, distinct from a limit of 1, which still gates). Release is
idempotent — a slot can be released at most once regardless of how many
times release is invoked.

**Persisted state.** None. The gate map is process-local and rebuilds from
zero on restart; the durable plane is the account-affinity ledger in §1/§6,
not this in-memory counter.

**Failure direction.** The gate must fail closed on capacity: a request over
the limit waits or times out (see §4), it is never over-admitted. It fails
open only on missing configuration: an unconfigured or malformed limit means
the request bypasses the gate rather than blocking forever on an undefined
ceiling.

**Conflict.** The two source trees disagree on which requests get keyed by
account at all: one applies account-keying to any connection carrying an
account-identity hash, regardless of the protocol family the request arrived
as; the other restricts account-keying to one first-party lane family and
keys every other protocol by bare model name. **Resolution: key by account
for ANY request whose resolved connection carries an account identity,
independent of protocol family.** Grounds: the resource being protected is
the physical account's provider-side concurrency ceiling, which does not
change meaning depending on which wire protocol the client used to reach it.
Keying only a subset of lanes lets the excluded protocols silently exceed the
same account's real capacity, defeating the ranking work in §1 and violating
the Account Scheduling Contract's "capacity configurable per connection"
rule, which is stated per connection, not per protocol.

---

### 3. Cooldown enforcement (lane, provider-lease, oversized-payload)

**Trigger.** Three independent cooldown triggers, evaluated per response:
(a) a lane-level 429/5xx with a `retry-after` header; (b) a provider
connection's lease reporting a cooldown reason; (c) a provider outright
rejecting a request payload as too large (HTTP 431 or 413).

**Inputs.** (a)/(b): the raw `retry-after` header value, which may arrive as
a string or a list (first element wins). Parsed as seconds when numeric,
otherwise as an HTTP-date. (c): none beyond the 431/413 status itself.

**Ordering/computation rule.** Negative seconds clamp to 0. A cooldown value
that is not finite, or resolves to a time already in the past, is ignored
entirely (no cooldown recorded). A recorded cooldown only ever moves the
gate's blocked-until time FORWARD (never shortens an existing cooldown) and
is capped at the lesser of the computed value and now + 600 seconds (10
minutes) — a hostile or malformed `Retry-After: 86400` cannot strand a lane
for a day. The 431/413 path is a FIXED 120 second cooldown, reason
"payload rejected", applied without any repin: the provider is saying the
request itself is too large, so retrying elsewhere is pointless and
re-pinning the session is strictly worse than waiting.

**Constants.** Cooldown ceiling: 600 s. Payload-rejection cooldown: fixed
120 s. Both apply per `(providerNode, accountHash)` gate, consistent with §2.

**Persisted state.** In-memory, per gate object; not durable across restart
(the durable affinity ledger in §6 is unaffected by a cooldown alone).

**Failure direction.** A cooldown call against an already-released lease
(a legitimate race: the client disconnected and released admission before a
delayed 429 arrived) returns a zero-duration no-op rather than raising —
raising inside a response-handling callback would be an unrecoverable process
crash for every concurrent session, so this path fails soft by design. A
cooldown call against an object that was never a valid lease at all is a
programming error and DOES raise.

---

### 4. Admission-wait timeout and Retry-After truth

**Trigger.** Any request that cannot immediately acquire an admission slot
(§2), and any response leaving with a retryable status.

**Inputs.** A configured admission timeout, default 180,000 ms (180 s),
overridable by environment/config, validated at startup as a positive
integer — an invalid value is a startup FAILURE, not a silent fallback to
some older default, so a misconfiguration cannot quietly reintroduce a short
timeout unnoticed. The same timeout bounds both the account gate (§2) and any
qualification/health-check admission queue, so they share one deadline.

**Ordering rule.** A request waits in FIFO order (§2) up to the timeout. On
timeout or client abort, whatever admission was already held is released,
and — only if the response has not already been written — the client
receives HTTP 503 with `retry-after: 1` and a structured failure record
(status, `complete: false`, `outcome: error`, an error class, and a
`failure_phase: admission` marker so an admission timeout is distinguishable
from a provider failure downstream).

**Constants.** Default timeout 180,000 ms. Retry-After floor: exactly `1`
(second) is asserted on any subscription-bound response carrying status 429,
502, 503, or 504 with no upstream `Retry-After` already set — upstream's own
value always wins; the floor only fills an absence, so a caller is never
told to retry with no delay hint at all.

**Persisted state.** None beyond the request's own log record.

**Failure direction.** FAILURE is a clean local 503 with a nonzero
`retry-after`, never an unbounded hang and never a silent success with no
provider request made. A caller can always distinguish "the queue timed out"
from "the provider rejected the request" by `failure_phase`.

---

### 5. Streaming keepalive (downstream heartbeat)

**Trigger.** During any 2xx streamed chat-completions response, once no
downstream byte has been written for the keepalive interval.

**Inputs.** A configured interval, default 10,000 ms (10 s), validated at
startup as a non-negative integer; 0 disables the feature entirely; an
invalid value is a startup failure.

**Eligibility, all required.** The response is a stream; the status is 2xx;
the request path is the streaming chat-completions endpoint; the client
connection is neither ended nor destroyed; the interval is nonzero.

**Ordering/rearm rule.** The keepalive timer is cleared and re-armed after
EVERY downstream write, by every code path that writes to the client, so a
heartbeat only ever fires during genuine silence and never interleaves with
real data. On backpressure (the write buffer is full), the next arm is
deferred to the buffer's drain signal rather than a blind timer, so a
congested client is never handed more bytes on top of a full buffer.

**Constants.** Default interval 10,000 ms. No retry count — this is a
liveness ping, not a data frame.

**Persisted state.** A per-request heartbeat count, folded into that
request's completion record only when nonzero.

**Failure direction.** This capability fails soft: on a destroyed or already-ended
response, the keepalive silently stops arming rather than erroring, and it
can never resurrect a dead stream or extend one past its real completion. It
is strictly a downstream liveness signal — it must never be mistaken for
upstream progress, and must never reset an independent upstream-stall clock.

---

### 6. Atomic durable-affinity repin on reconfiguration

**Trigger.** A configuration refresh re-ranks accounts (§1) and produces a
new preferred account for a route that an existing client session is already
pinned to under the OLD account.

**Inputs.** The session's affinity key (derived from a signed in-band
affinity marker when the client supplies one, otherwise from the parent
conversation identity; a request with neither is a hard error, not a silent
default pin), the existing affinity record, and the newly ranked binding
(account identity + connection identity).

**Ordering/invariant rule.** A repin is permitted only when the route itself
(provider + endpoint) is UNCHANGED — only the account within a fixed route
may move, never the route. An assignment that does not already exist cannot
be "repinned" (that is a different error). A repin whose new binding is
byte-identical to the old one is rejected as a pointless no-op — a repin
must always change something. The clock stamped on the updated record is
monotonic (never regresses) even if the wall clock is skewed.

**Atomicity.** The update is copy-on-write: build the new ledger state,
persist it durably, and only then swap the live view. A concurrent reader
never observes a half-written ledger, and a failed persist leaves the
previous, still-consistent state in place.

**Persisted state.** The affinity ledger: session-to-account binding, keyed
by affinity hash and model, durable across restart.

**Failure direction.** A route mismatch, or a binding missing an account or
connection identity where one is required, must still fail closed with a
capacity-class error — only a CHANGED, otherwise-valid binding is downgraded
from an error into a transparent repin. An affinity binding is also dropped
outright (not repinned) when its pinned endpoint enters cooldown (§3):
holding a session pinned to a provider that is actively cooling down is worse
than losing the pin.

**Conflict.** The two source trees disagree on outcome for the identical
scenario: one treats a stale binding as a transparent, atomic repin; the
other treats the same mismatch as a hard capacity-class failure that the
caller must retry. **Resolution: atomic repin is authoritative — a
reconfiguration must never turn an in-flight or resuming session into a hard
failure when a valid new binding exists.** Grounds: this is the specific
capability RECONCILIATION.md's capability matrix names as required future
work ("fold this into the durable affinity transaction"), and treating a
routine re-rank as a caller-visible error would make every configuration
refresh a reliability regression.

---

### 7. Service-tier verbatim preservation and bounded managed-429 retry replay

Two behaviors, covered together because both are response/retry metadata
fidelity rules on the same request path.

**7a. Service-tier preservation.** Trigger: any request carrying a
string-typed service-tier field (for example `default`, `priority`,
`ultrafast`, or a caller-supplied value TokenProxy does not itself define).
Rule: the value is recorded into the request's receipt VERBATIM — no
remapping, no collapsing an unrecognized tier onto a known one, no default
substitution. A non-string tier contributes no field at all (omitted, not
recorded as null or a wrong value). Failure direction: a malformed tier fails
by OMISSION — the receipt has no tier field — never by recording an
incorrect one.

**7b. Bounded managed-429 retry replay.** Trigger: an upstream response that
is a canonical bare rate-limit error (status 429 with no other structured
error body), on a request bound to a managed subscription lease.

**Ordering rule, all conditions required to retry.** The upstream transport
completed cleanly (a connection reset mid-body is a DIFFERENT failure class
and is never treated as a rate limit); fewer than 3 retries already
attempted on this request; the buffered response body matches the canonical
bare rate-limit shape; and nothing has been written to the client yet.
Failing any condition replays the buffered upstream response to the client
as-is instead of retrying. A retry replays on the EXACT SAME account lease
and pinned headers — no model substitution, no account substitution, no
endpoint substitution.

**Constants.** Retry ceiling: 3 attempts. Body-inspection buffer bound:
262,144 bytes (256 KiB) — a body exceeding this is treated as a synthetic
"exceeded inspection limit" error and the retry path is abandoned; bytes past
the limit are dropped, never buffered further. Backoff is driven by the
upstream's own `Retry-After` value, not a fixed local delay.

**Persisted state.** `retry_count` is carried into every request record,
starting at 0 and incrementing per replay, so a client-visible receipt always
shows how many replays occurred.

**Failure direction.** Every stream exit path (clean end, abort, transport
error, or unexpected close) settles the request exactly once behind a
single-fire guard, so a retry decision is made at most once per attempt and
never double-fires; a transport error that is not a clean completion must
fail closed to the client's original connection rather than silently
retrying it.

---

### 8. `subscription_lane.max_concurrency` ceiling

**Trigger.** Every admission decision in §2 for a subscription-bound lane
reads this single configured ceiling.

**Inputs.** One integer, configured per deployment (not per request).

**Constants and conflict.** The two source values on record are **2** and
**80**. **Resolution: 80 is authoritative for the default deployment
configuration; the ceiling itself must be configurable per account, not
hardcoded.** Grounds: the acceptance-test contract for this migration
explicitly requires "at least 80 concurrent isolated HTTP requests complete
or wait ... without ... starvation," which a ceiling of 2 cannot satisfy —
one account would queue the 3rd of 80 simultaneous callers. The value of 2
is stale prior configuration, not a deliberate resilience choice; nothing in
either source tree argues FOR 2 on resilience grounds. At a ceiling of 80,
one account admits 80 concurrent requests and the 81st queues under §4's
timeout; at a ceiling of 2, everything past the 2nd queues. Both values are
observed in the wild, so the ceiling must remain a live configuration knob,
not a compiled-in constant, precisely because reasonable operators disagree
on it.

**Persisted state.** Configuration only; not runtime state.

**Failure direction.** A misconfigured (non-positive, non-integer) ceiling
is treated as "ungated" per §2, not as a crash — but an ungated subscription
lane is itself a resilience regression worth alerting on, since a lane that
does not fail closed removes the account-protection invariant this whole
cluster of behaviors exists to provide.

---

### 9. Runtime dependency parity without byte-patching

**Trigger.** Every TokenProxy build and release, replacing the predecessor's
runtime patch step entirely.

**Inputs.** None beyond the pinned upstream dependency version TokenProxy
already builds against.

**Rule.** No install step may patch bytes inside a third-party dependency
after installation. Every behavior the predecessor's patch used to provide —
correct handling of a maximum-effort request parameter, cache-control
propagation, cache and cost truth in usage accounting, tool-fragment
normalization in streamed output, correct usage-only stream termination,
exact account-pin fidelity, deterministic 4xx error handling, provider
metadata propagation, generation-id propagation, and removal of bundled log
noise — must be proven present through the DEPENDENCY'S OWN release, not
reintroduced as a second local patch.

**Constants.** None; this section removes a component (previously ~385 lines
of runtime patch code) rather than adding one.

**Persisted state.** None.

**Failure direction.** Until every one of the ten listed behaviors above has
its own passing acceptance test against the un-patched dependency, this
capability is UNPROVEN, not done — parity is a claim requiring evidence, and
the default assumption for any unverified item on this list is FAILURE
until a test says otherwise. This is a build-time gate that must fail closed:
a release with any unproven item does not ship.

---

### 10. Unbound-account availability after reconfiguration

**Trigger.** Every configuration/ranking refresh (§1) that produces a new
preferred account for a route, leaving one or more previously-considered
accounts unbound to any route in the current snapshot.

**Inputs.** The full ranked candidate list from §1, and each candidate's
prior activation state.

**Rule.** An account that no current route selected as its PRIMARY pin stays
available (active) as failover inventory for the next refresh, rather than
being administratively deactivated the moment it is not the winner. The
config refresh in §1 always evaluates the full candidate set, so demoting a
currently-unbound account to "inactive" only removes information the next
ranking pass would otherwise use.

**Constants.** None numeric; this is a state-machine rule (2-valued:
active/inactive) applied per account.

**Persisted state.** Each account's activation flag, distinct from its
current route binding.

**Failure direction.** This fails soft toward availability: an unbound account remains
selectable by the next ranking pass rather than requiring manual
re-enablement. The tradeoff this accepts is that a first-party route could,
in principle, answer from an account no route currently prefers if activation
and ranking briefly disagree — accepted because losing failover inventory to
premature deactivation is judged worse than that narrow window. Native
qualification and health status (a separate capability) is the correct place
to gate whether an account may serve traffic at all, not this sweep.

**Conflict.** The two source trees are directly contradictory on the exact
same reconfiguration run: one leaves a formerly-unbound account deactivated,
the other leaves it active. **Resolution: leave it active (already stated
above).** Grounds: RECONCILIATION.md's Account Scheduling Contract requires
ranking across ALL eligible accounts on every repin decision (item 5: "if an
earlier account resets while a later account is active, atomically return to
the earliest restored account"), which is only possible if non-winning
accounts remain live rather than disabled between refreshes.

---

### 11. Account re-ranking runs before evidence publication on every refresh

**Trigger.** Every periodic or triggered state refresh, before any
provider-evidence or catalog data is regenerated for consumption.

**Inputs.** The same connection and quota inputs as §1.

**Ordering rule, load-bearing.** Re-ranking (§1) MUST complete and its
result MUST be durably written FIRST; evidence regeneration reads that
freshly written snapshot SECOND. Reversing the order means evidence
publication can observe a stale pin that the same refresh cycle was about to
correct, defeating the purpose of the refresh.

**Constants.** None.

**Persisted state.** The same ranked-connection snapshot as §1, consumed
in-process by the subsequent evidence step within the same refresh run.

**Failure direction.** If the ranking step is unavailable or fails, the
refresh must fail closed for that cycle — it must not fall through to
regenerating evidence from a stale or absent ranking, since a refresh that
silently skips re-ranking reintroduces exactly the stale-pin problem this
capability exists to close.

---

### 12. Out of scope for TokenProxy — workflow fan-out and host admission policy

This section covers 4 behaviors from the private extraction (coupled
fan-out/budget constants, weighted host-lease accounting removal, workflow
semaphore batching width, and the nested-subagent-spawn guard). All four are
EDGE-owned per the Ownership Boundary table (Workflow planning; Host-level
agent admission) and are described here only so the spec's coverage is
complete — TokenProxy implements none of it.

**What it is.** A coupled constant set governing how many agents one harness
workflow may run concurrently (observed values 8 or 32, disagreeing across
the two source trees), the workflow's total lifetime agent-invocation ceiling
(observed 400, or absent/unbounded), maximum nested-spawn depth (observed 1
or 5), whether a worker may itself spawn further agents (observed true/false
across the two trees), a per-run wave count (observed 5 in both trees, the
one point of agreement), and a transient-child retry ceiling (observed 3 in
both trees, also agreed). A host-wide admission layer separately tracks
active agent/task/workflow leases, either as weighted slots that can refuse a
new dispatch outright, or as unweighted lifecycle records that never refuse
and push all real enforcement to the workflow layer and the account gate in
§2 — the two source trees disagree on which model is active. A guard that
blocks a child agent from itself invoking another agent/task is present in
one source tree and removed in the other.

**Why it is out of scope.** All of this governs how many logical clients the
edge creates and how the edge's own host protects itself from being
overwhelmed by its own fan-out — a concern that exists whether or not
TokenProxy is in the request path at all, and one TokenProxy has no
visibility into (it sees requests, not workflow-wave topology). TokenProxy's
own account-scoped admission gate (§2) and per-account concurrency ceiling
(§8) are the correct and sufficient backpressure signal the edge should react
to; TokenProxy must not also implement a workflow-depth or wave-count notion.

**Conflict, and how it resolves.** The coupled constant set (fan-out cap,
host cap, per-workflow active cap, lifetime invocation cap, spawn depth, wave
count, nested-spawn permission, retry ceiling) is enforced identically across
a shared registry file, a JSON schema, and two separate guard programs in the
edge repository, specifically so no single file can drift from the others.
**These coupled constants reconcile atomically or not at all** — a change to
any one of them without the matching change to the registry, the schema, and
both guard programs in the SAME edge-repository commit leaves host admission
either refusing every session (an over-strict stale guard) or accepting an
unbounded fan-out (a guard that no longer matches its own registry). This is
purely an edge-repository concern; TokenProxy neither reads nor enforces any
of these 8 values, and this document takes no position on which of the two
observed value sets (8/400/depth-5/nested-allowed vs. absent/depth-1/
nested-blocked) is correct, only that whichever set is chosen ships as one
atomic edge-repository commit. The failure direction for the edge guard itself
is fail closed at startup: a registry value that does not match the
schema's fixed constant, or does not match what the admission guard
programs expect, is a hard startup FAILURE for the edge tooling, not a
silent fallback.

---

### 13. Out of scope for TokenProxy — reproducible-source deployment gate

**What it is.** Before activating a new release of the edge-side router
tooling, a gate verifies the deployment source is byte-identical to what a
remote build would reproduce: the checked-out commit must equal the
published upstream branch tip, there must be zero uncommitted diff against
that commit for the managed file set, and zero untracked files under that
same managed set. Path arguments are validated to reject anything empty,
absolute, or containing a directory-traversal component, and the managed
path list is fixed to roughly 7 specific paths (the router service
directory, its two registry files, and 4 named operator scripts).

**Why it is out of scope.** This is a deployment-integrity check for the
EDGE's own operator tooling, not for TokenProxy — it governs whether the
edge repository's local checkout is safe to promote to "what other machines
will pull," a property of the edge's git history and CI, unrelated to
TokenProxy's request or account-selection behavior. Ownership Boundary table:
"Activation, draining, and rollback command" is edge-owned (thin operator
wrappers), even though the state transition they call lives in TokenProxy.

**Failure direction.** Every branch of this gate must fail closed: an unresolved
publish reference, a dirty diff, or any untracked file under the managed
path set all refuse the deployment outright rather than proceeding with a
warning. Unrelated dirty work OUTSIDE the managed path set does not block
it — the scope is deliberately narrow to the files that are actually
promoted.

---

### 14. Out of scope for TokenProxy — operator drain-wait timeout before activation

**What it is.** When an operator flips the edge's front-proxy from one
release to another, live in-flight dispatches are given a bounded wait
before the flip is declared failed. The observed default moved from 10
seconds to 180 seconds across the two source trees, both agreeing on the new
180-second value (no conflict between them) — matched deliberately to the
same 180-second admission-wait ceiling TokenProxy itself exposes in §4, so
that a caller legitimately queued for the full admission window is not cut
off mid-drain by a shorter activation timeout.

**Why it is out of scope.** This is the EDGE's own control-plane operator
command against its front-proxy socket, not a TokenProxy behavior — it is
explicitly the "thin operator wrapper calling an admin ABI" pattern the
Ownership Boundary table assigns to the edge. TokenProxy's obligation is
only to make its own admission-wait ceiling (§4) discoverable/configurable so
the edge's drain timeout can be kept consistent with it; TokenProxy does not
itself implement or expose a drain-wait timer.

**Constants.** 180 seconds, matched to §4's admission-wait default.

**Failure direction.** A drain that does not settle within the configured window must fail closed: it is reported to the operator as a failed pause or
activation, and the edge does not force-kill in-flight requests to make the
timeout look successful.

---

### 15. Out of scope for TokenProxy — temporary interactive-session directory mirror

**What it is.** A small polling script that mirrors one retiring interactive
session's on-disk project directory into a renamed successor directory every
60 seconds while a given process id is alive, plus one final sync after that
process exits, explicitly excluding the curated long-term memory file so it
is never clobbered by the mirror.

**Why it is out of scope.** This exists only to keep ONE specific retiring
interactive tool session's local state readable across a directory rename
during this migration; it is explicitly not a product capability of either
system. RECONCILIATION.md lists it under "Drop after cutover" — it has no
long-term owner on either side because it is not meant to outlive the
migration window.

**Constants.** Poll interval: 60 seconds.

**Failure direction.** The mirror fails soft: a failed sync attempt is
silently skipped and retried on the next 60-second tick rather than raising,
because it is disposable session-convenience state, not a system of record —
losing one tick has no failure mode worse than a moment of staleness in a
directory nothing durable depends on.
