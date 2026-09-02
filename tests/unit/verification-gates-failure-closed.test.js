import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const releaseGate = join(repo, "docs/design/verification/check-modernization-release.sh");
const lintGate = join(repo, "docs/design/verification/check-lint-delta.sh");
const scratchDirectories = [];

function scratchDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "tokenproxy-gate-test-"));
  scratchDirectories.push(directory);
  return directory;
}

function writeExecutable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function runReleaseGate(contents) {
  const directory = scratchDirectory();
  const report = join(directory, "vitest-results.json");
  writeFileSync(report, contents);
  return spawnSync("bash", [releaseGate, "--verify-vitest-report", report], {
    encoding: "utf8",
    env: {
      ...process.env,
    },
  });
}

function runLintReport({ output, status }) {
  const directory = scratchDirectory();
  const outputPath = join(directory, "eslint.json");
  writeExecutable(
    join(directory, "npx"),
    `#!/usr/bin/env bash\nprintf '%s' "\${FAKE_ESLINT_OUTPUT}"\nexit "\${FAKE_ESLINT_STATUS}"\n`,
  );
  return spawnSync(
    "bash",
    [lintGate, "--run-eslint", directory, outputPath, "input.js"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        FAKE_ESLINT_OUTPUT: output,
        FAKE_ESLINT_STATUS: String(status),
        ESLINT_NPX: join(directory, "npx"),
      },
    },
  );
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("modernization release report verification", () => {
  it.each([
    ["an empty report", ""],
    ["malformed JSON", "{not-json"],
    ["a report with no test assertions", JSON.stringify({
      testResults: [{ name: "/tmp/worktree/tests/unit/empty.test.js", assertionResults: [] }],
    })],
  ])("rejects %s", (_name, contents) => {
    const result = runReleaseGate(contents);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Vitest report/i);
  });

  it("accepts a known baseline failure only after parsing a nonempty report", () => {
    const result = runReleaseGate(JSON.stringify({
      testResults: [{
        name: "/tmp/worktree/tests/translator/bugs-toClaude-context.test.js",
        assertionResults: [{
          status: "failed",
          fullName: "OpenAI \u2192 Claude context mapping assistant reasoning_content becomes a thinking block",
        }],
      }],
    }));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No regression");
  });

  it("rejects a parsed report containing a new regression", () => {
    const result = runReleaseGate(JSON.stringify({
      testResults: [{
        name: "/tmp/worktree/tests/unit/new-regression.test.js",
        assertionResults: [{ status: "failed", fullName: "new regression" }],
      }],
    }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("REGRESSION");
  });
});

describe("lint delta report verification", () => {
  it("rejects an ESLint execution failure even when it emits valid JSON", () => {
    const result = runLintReport({ output: "[]", status: 2 });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/ESLint execution failed/i);
  });

  it("rejects malformed ESLint JSON after a successful execution", () => {
    const result = runLintReport({ output: "{not-json", status: 0 });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/ESLint report/i);
  });

  it("accepts ESLint findings when the report is real and parseable", () => {
    const result = runLintReport({
      output: JSON.stringify([{
        filePath: "/tmp/input.js",
        messages: [{ ruleId: "example-rule", severity: 2, message: "baseline finding" }],
        errorCount: 1,
        warningCount: 0,
      }]),
      status: 1,
    });

    expect(result.status).toBe(0);
  });
});
