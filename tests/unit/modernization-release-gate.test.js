import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../docs/design/verification/check-modernization-release.sh", import.meta.url),
);
const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const source = readFileSync(script, "utf8");

const passingReport = {
  testResults: [
    {
      name: "/fixture/tests/unit/passing.test.js",
      assertionResults: [{ status: "passed", fullName: "passing test" }],
    },
  ],
};

const knownFailureReport = {
  testResults: [
    {
      name: "/fixture/tests/translator/bugs-toClaude-context.test.js",
      assertionResults: [
        {
          status: "failed",
          fullName:
            "OpenAI \u2192 Claude context mapping assistant reasoning_content becomes a thinking block",
        },
      ],
    },
  ],
};

const regressionReport = {
  testResults: [
    {
      name: "/fixture/tests/unit/new-regression.test.js",
      assertionResults: [{ status: "failed", fullName: "new regression" }],
    },
  ],
};

function runReportVerifier(report, vitestStatus) {
  const scratch = mkdtempSync(join(tmpdir(), "tokenproxy-release-verifier-"));
  const reportPath = join(scratch, "vitest-results.json");
  writeFileSync(reportPath, typeof report === "string" ? report : JSON.stringify(report));

  const args = [script, "--verify-vitest-report", reportPath];
  if (vitestStatus !== undefined) args.push(String(vitestStatus));

  try {
    return spawnSync("bash", args, { cwd: repo, encoding: "utf8" });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

describe("modernization release gate", () => {
  it("builds and tests a temporary copy, never the shared worktree", () => {
    expect(source).toContain('mktemp -d "${TMPDIR:-/tmp}/tokenproxy-release.XXXXXX"');
    expect(source).toContain('git -C "$repo" worktree add --detach "$worktree" HEAD');
    expect(source).toContain('git -C "$repo" worktree remove --force "$worktree"');
    expect(source).toContain("rsync -a");
    expect(source).toContain("--exclude=.claude");
    expect(source).toContain('"$worktree/.next"');
    expect(source).toContain("npm install --no-audit --no-fund");
    expect(source).not.toContain("npm ci --no-audit --no-fund");
    expect(source).not.toContain('ln -s "$repo/node_modules"');
    expect(source).toContain('DATA_DIR="$worktree/.verification-data"');
    expect(source).toContain("mise x node@24.15.0 -- npm run build");
    expect(source).toContain("verify-no-regression.mjs");
    expect(source).toContain("verify-providers.mjs");
    expect(source).toContain("verify-alias.mjs");
    expect(source).toContain("verify-oauth-urls.mjs");
    expect(source).not.toContain('--outputFile.json="$report" || true');
    expect(source).toContain(") || vitest_status=$?");
    expect(source).toContain('verify_vitest_report "$report" "$worktree" "$vitest_status"');
    expect(source).toContain("modernization release gates ok");
  });

  it("fails when Vitest exits nonzero despite a valid report", () => {
    const result = runReportVerifier(passingReport, 1);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Vitest exited nonzero with status 1");
  });

  it("fails closed when the Vitest JSON report is invalid", () => {
    const result = runReportVerifier("{invalid json");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Vitest report is invalid or contains no test results");
  });

  it("fails closed when a Vitest result is structurally invalid", () => {
    const result = runReportVerifier({
      testResults: [
        {
          name: null,
          assertionResults: [{ status: "failed", fullName: "broken result" }],
        },
      ],
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Vitest report is invalid or contains no test results");
  });

  it("accepts failures present in the known-failure baseline", () => {
    const result = runReportVerifier(knownFailureReport);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No regression. (now fails=1");
  });

  it("accepts Vitest's normal nonzero status when every failure is baseline-known", () => {
    const result = runReportVerifier(knownFailureReport, 1);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No regression. (now fails=1");
  });

  it("rejects failures absent from the known-failure baseline", () => {
    const result = runReportVerifier(regressionReport);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("REGRESSION: 1 new test failure(s)");
  });
});
