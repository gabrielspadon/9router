#!/usr/bin/env node
// Regenerates docs/design/evidence/verification-summary.md from the gates
// themselves rather than from memory. Every number in that document is the
// output of a command run here, so the summary cannot drift from the tree the
// way a hand-written one does.
//
//   node docs/design/verification/write-summary.mjs
//
// The two inputs it cannot produce itself are the suite result and the smoke
// result, because both need something running. Pass them:
//   VITEST_RESULTS=/tmp/r3-vitest.json TP_PORT=<isolated> node .../write-summary.mjs
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const grab = (text, re, fallback = "not measured") => (text.match(re)?.[1] ?? fallback);

// A gate whose script is absent must not read as a measurement that ran. An
// unresolvable `node <script>` exits non-zero with empty stdout, which the
// `grab` fallbacks then render as "not measured" and the behaviour verdict
// renders as "DIFFERS" -- a fabricated finding rather than a missing input. So
// the script list is checked first and a missing one stops the summary.
const gate = (script, args = []) => {
  const path = `docs/design/verification/${script}`;
  if (!existsSync(path)) {
    console.error(`missing verification gate: ${path}`);
    process.exit(2);
  }
  return run(script.endsWith(".sh") ? "bash" : "node", [path, ...args]).stdout || "";
};

const behaviour = gate("check-behaviour.mjs");
const contrast = JSON.parse(gate("contrast.mjs", ["--json"]) || "{}");
const reports = gate("check-reports.mjs");
const shots = gate("check-shots.mjs");
const lint = run("bash", ["docs/design/verification/check-lint-delta.sh"]).stdout || "";
const lintSummary = /no lintable files changed/.test(lint)
  ? "no changed JavaScript files"
  : grab(lint, /(findings in changed files: \d+ at base, \d+ on branch)/);
const inventoryAfter = "docs/design/evidence/raw/inventory-after.json";
// A baseline is only usable if it was captured from the same seed as the
// after-capture. Preferring a fixture by filename picked one whose seed no
// longer exists on disk, so the comparison it produced could not be rerun.
const seedOf = (p) => {
  try { return JSON.parse(readFileSync(p, "utf8")).provenance?.seedDigest || ""; }
  catch { return ""; }
};
const afterSeed = seedOf(inventoryAfter);
const inventoryBefore = [
  "docs/design/evidence/raw/inventory-before-real-seed.json",
  "docs/design/evidence/raw/inventory-before.json",
].find((p) => existsSync(p) && afterSeed && seedOf(p) === afterSeed)
  ?? "docs/design/evidence/raw/inventory-before.json";
const inv = (p) => {
  if (!existsSync(p)) return null;
  const d = JSON.parse(readFileSync(p, "utf8"));
  return { total: d.total, routes: Object.keys(d.routes).length };
};
// check-inventory.mjs exits non-zero when the provenance gate or the parity
// gate fails. Reading only its stdout rendered a failed run as a clean summary,
// so the status is carried into the report alongside the numbers.
const invRun = run("node", [
  "docs/design/verification/check-inventory.mjs",
  "--before-file", inventoryBefore,
  "--after-file", inventoryAfter,
]);
const invCheck = invRun.stdout || "";
const invFailed = invRun.status !== 0;
const invStderr = (invRun.stderr || "").trim().split("\n").filter(Boolean).slice(-3).join(" ");
const before = inv(inventoryBefore), after = inv(inventoryAfter);

// `verify-no-regression.mjs` prints one line when it passes and a multi-line
// list when it fails, and it signals which by exit status. Taking `.pop()` of
// the output rendered a failing run as a blank line, so a regression appeared
// in the report as silence. The status decides, and a failure names itself.
const regressionRun = process.env.VITEST_RESULTS && existsSync(process.env.VITEST_RESULTS)
  ? run("node", ["tests/__baseline__/verify-no-regression.mjs", process.env.VITEST_RESULTS])
  : null;
const regression = !regressionRun
  ? "not run in this pass; run `cd tests && npx vitest run --reporter=json --outputFile=<f>` and set VITEST_RESULTS"
  : regressionRun.status === 0
    ? (regressionRun.stdout || "").trim().split("\n").filter(Boolean).pop()
    : `**FAILED** (exit ${regressionRun.status}). ${[regressionRun.stdout, regressionRun.stderr]
        .join("\n").trim().split("\n").filter(Boolean).join(" ")}`;
// The smoke helper names the instance URL and its port. A committed report must
// carry neither, so both are masked before the line is quoted into the summary.
const smoke = (run("bash", ["docs/design/verification/check-smoke.sh"]).stdout || "")
  .replace(/\bhttps?:\/\/[^\s"'<>]+/g, "[isolated instance]")
  .replace(/\b\d{4,5}\b/g, "[port]");

// Counted from the audit JSON rather than written here. The prose said "four
// routes" while the capture measured five, which is exactly the class of defect
// a generated report exists to prevent.
const i18nPath = "docs/design/evidence/i18n/i18n-audit.json";
const localisation = (() => {
  if (!existsSync(i18nPath)) return "not measured in this pass";
  let data;
  try { data = JSON.parse(readFileSync(i18nPath, "utf8")); } catch { return "capture unreadable"; }
  // Measurements are keyed `locale|route` on the desktop viewport and
  // `locale|route|surface` elsewhere, with `provenance` alongside them.
  const locales = new Set(), routes = new Set(), viewports = new Set();
  let count = 0, overflow = 0;
  for (const [key, row] of Object.entries(data)) {
    if (key === "provenance" || !row || typeof row !== "object") continue;
    const [loc, route, surface] = key.split("|");
    locales.add(loc); routes.add(route); viewports.add(surface || "desktop");
    count += 1;
    overflow += Number(row.overflow || 0);
  }
  const n = (c, one, many) => `${c} ${c === 1 ? one : many}`;
  return `${n(locales.size, "locale", "locales")} across ${n(routes.size, "route", "routes")} at `
    + `${n(viewports.size, "viewport", "viewports")}, ${count} measurements, `
    + `${overflow} horizontal overflow${overflow === 1 ? "" : "s"}`;
})();

// The audit table is already generated by check-reports into audit-report.md;
// the summary links it rather than restating it in a second place that can
// disagree with the first.
const auditRows = existsSync("docs/design/evidence/audit-report.md")
  ? readFileSync("docs/design/evidence/audit-report.md", "utf8").split("\n").filter((l) => l.startsWith("|")).join("\n")
  : "| the audit report has not been generated | | | |";
// A baseline with no provenance block cannot be shown to have come from the
// same seed as the after capture, so it is not a baseline for anything. Saying
// "no navigation failures" over such a file reads as a pass earned by an
// unidentified artifact.
const auditBaseline = existsSync("docs/design/evidence/raw/before.json")
  ? JSON.parse(readFileSync("docs/design/evidence/raw/before.json", "utf8"))
  : null;
const baselineSeed = auditBaseline?.provenance?.seedDigest || "";
const baselineNavigationFailures = Object.values(auditBaseline?.routes || {})
  .filter((route) => route.navError).length;
const auditComparability = !auditBaseline
  ? "not established. There is no baseline browser capture, so no before-and-after claim is made."
  : !baselineSeed
    ? "not established. The baseline capture records no provenance, so it cannot be shown to share the after capture's seed. Treat it as an unidentified artifact, not as evidence."
    : afterSeed && baselineSeed !== afterSeed
      ? "not established. The baseline capture was taken from a different seed than the after capture, so the two are not comparable."
      : baselineNavigationFailures
        ? `limited. ${baselineNavigationFailures} baseline navigation failure${baselineNavigationFailures === 1 ? "" : "s"} makes before-and-after improvement claims non-comparable; the current capture remains independently verified.`
        : "equivalent same-seed captures with no baseline navigation failure.";
// Existence is not a measurement. A report with no samples, or one built from a
// different snapshot than the instance under audit, must not be claimed as
// performance evidence just because the file is on disk.
const performance = (() => {
  const p = "docs/design/evidence/performance-report.json";
  if (!existsSync(p)) return null;
  try {
    const d = JSON.parse(readFileSync(p, "utf8"));
    const samples = Array.isArray(d.measurements) ? d.measurements.length : 0;
    if (!samples) return null;
    return { samples, buildId: d.provenance?.buildId || "", problems: (d.problems || []).length };
  } catch { return null; }
})();
const afterBuild = (() => {
  try { return JSON.parse(readFileSync(inventoryAfter, "utf8")).provenance?.buildId || ""; }
  catch { return ""; }
})();

const md = `# Verification summary

Every number here is the output of a command in
\`docs/design/verification/\`, regenerated by
\`docs/design/verification/write-summary.mjs\`. Nothing in it is written by
hand, so it cannot disagree with the tree.

## Behaviour

| Check | Result |
|---|---|
| Behavioural entries, whole source tree | ${grab(behaviour, /behavioural entries: (\d+ at base, \d+ at HEAD)/)} |
| Distinct entries | ${grab(behaviour, /distinct entries: (\d+ at base, \d+ at HEAD)/)} |
| Source files compared | ${grab(behaviour, /source files: (\d+ at base, \d+ at HEAD)/)} |
| Read-only path trespass, committed history and working tree | ${/READ_ONLY_TRESPASS/.test(behaviour) ? behaviour.match(/READ_ONLY_TRESPASS=\d+/)[0] : "none"} |
| Verdict | ${/BEHAVIOUR OK/.test(behaviour) ? "identical" : "DIFFERS"} |

The fingerprint carries hook call sites, event-handler expression bodies, fetch
and axios calls with their arguments, request-path literals, state setters,
navigation calls and imports from the routing, store, model and API layers, as
one multiset over the whole source tree with no filename in the entries. A
control may move between components; it may not change.
\`prove-behaviour-sensitive.sh\` injects cases the checker must catch, so a
passing fingerprint is not a vacuous one.

## Capability parity

| Check | Result |
|---|---|
| Controls recorded before | ${before ? `${before.total} across ${before.routes} routes` : "no capture"} |
| Controls recorded after | ${after ? `${after.total} across ${after.routes} routes` : "no capture"} |
| Relocated | ${grab(invCheck, /relocated: (\d+)/)} |
| Accounted for on the record | ${grab(invCheck, /accounted for: (.+)/)} |
| More than one action deep | ${grab(invCheck, /deeper than one action: (\d+)/)} |
| Unreachable | ${grab(invCheck, /unreachable: (\d+)/)} |
| Parity gate | ${invFailed ? `**FAILED** (exit ${invRun.status}${invStderr ? `: ${invStderr}` : ""}). The numbers above are from a run that did not pass; treat this section as an open finding, not evidence.` : "passed"} |

The walk records every interactive control that is visible, then opens each
non-destructive disclosure once and records what that reveals, so "one action
away" is measured rather than asserted. Nothing destructive is ever clicked.

A control may leave the product only on the record.
[capability-dispositions.json](capability-dispositions.json) names each one and
the commit that removed or relabelled it, and a relabelled control has to be
present under its new name, so a rename cannot hide a removal.

## Browser audit

Baseline capture: ${grab(shots, /before: (\d+ routes, \d+ views, \d+ screenshots)/, "none")}.
Current capture: ${grab(shots, /after: (\d+ routes, \d+ views, \d+ screenshots)/, "none")}.

${auditRows}

Audit comparability: ${auditComparability}

Full detail in [audit-report.md](audit-report.md). The screenshots are committed
under \`docs/design/evidence/routes/\` as WebP.

## Colour

${contrast.rows ? `${contrast.rows.length} measurements across both themes against the live token values, ${contrast.failures} below requirement. They come from ${new Set(contrast.rows.map((r) => `${r.fg}|${r.bg}`)).size} declared pairs, each measured in every theme it declares.` : "not measured"}
The pair list is \`docs/design/tokens.pairs.json\` and the tables in the design
system are generated, not written.

## Lint

${lintSummary}. ${/LINT DELTA OK/.test(lint) ? "Zero new." : `NEW FINDINGS. ${grab(lint, /NEW_LINT_FINDINGS=(\d+)/, "An unrecorded number of")} file-and-rule keys grew.`}
The two totals can match while the verdict is NEW FINDINGS, because the check
is keyed on file and rule rather than on the total: a finding that moved and a
finding that appeared cancel in the sum but not in the key.
Both sides are linted in a throwaway worktree with the same config and
dependencies, keyed on file and rule rather than line, so a finding that moved
down a file is not counted as new.

## Test suite

The suite is not green on a plain checkout and is not judged by a raw count.
The authority is \`tests/__baseline__/verify-no-regression.mjs\`:

    ${regression}

## Performance

${!performance
  ? "not measured. No performance report with samples is present, so no performance claim is made."
  : !performance.buildId || !afterBuild
    ? `measured, but the build it was taken from cannot be established: ${!performance.buildId ? "the performance report records no build id" : "the capability inventory records no build id"}. Numbers that cannot be tied to a build are not evidence for this one, so treat them as unverified until re-measured.`
    : performance.buildId !== afterBuild
    ? `measured, but NOT comparable to this evidence set. The performance report was taken from build \`${performance.buildId}\`, while the capability inventory was captured from build \`${afterBuild}\`. Treat the numbers as stale until re-measured against the audited build.`
    : `${performance.samples} samples across cold and warm modes, ${performance.problems} browser problem${performance.problems === 1 ? "" : "s"}, from build \`${performance.buildId}\`. [performance-report.json](performance-report.json) has the raw samples; [performance-report.md](performance-report.md) has the p75 table and the budget gaps, Budget gaps remain explicit rather than reported as passes.`}

## Isolated instance

${smoke.split("\n").filter((l) => l.trim()).slice(0, 1).join("") || "not running"}. Built from source with its own
\`DATA_DIR\`, seeded by a read-only \`sqlite3 .backup\` of the live database so
the audit runs against realistic routing data. The protected production
services are never touched, never rebuilt over and never restarted.
${/SMOKE OK/.test(smoke) ? "The repository's own smoke test passes against it." : "The smoke test did not pass; see above."}

The audit runs on its own unused isolated port, recorded in the run log rather
than here: a committed report must not name a local endpoint or port.

## Localisation

${localisation}. Detail, the truncation and nowrap counts, and
the right-to-left finding are in
[localisation-report.md](localisation-report.md).
`;

writeFileSync("docs/design/evidence/verification-summary.md", md);
console.log("wrote docs/design/evidence/verification-summary.md");
