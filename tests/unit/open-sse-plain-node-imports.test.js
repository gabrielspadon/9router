import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function renderCjsLoadProbe(sourcePath, outputPath, { cursor = false } = {}) {
  const source = readFileSync(sourcePath, "utf8");
  const createRequireShim = `
    const { createRequire: createNodeRequire } = require("node:module");
    const createRequire = (url) => {
      if (!url) throw new Error("CJS emission must not call createRequire with import.meta");
      return createNodeRequire(url);
    };
  `;

  // Strip the whole leading import block rather than anchoring on one specific
  // module. Anchoring on `from "node:module";` coupled this probe to a single
  // import line: removing or reordering it left the ESM header in the emitted
  // CJS, and the failure surfaced as "cursor did not load" rather than as a
  // transform that no longer matched.
  const LEADING_IMPORTS = /^(?:import\s[\s\S]*?from\s+"[^"]+";\n|import\s+"[^"]+";\n)+/;
  const cjs = cursor
    ? source
      .replace(LEADING_IMPORTS, `${createRequireShim}\nclass BaseExecutor {}\n`)
      .replaceAll("export function ", "function ")
      .replace("export class CursorExecutor", "class CursorExecutor")
      .replace("export default CursorExecutor;", "module.exports = { CursorExecutor };")
    : source
      .replace('import crypto from "node:crypto";', 'const crypto = require("node:crypto");')
      .replace('import { createRequire } from "node:module";', createRequireShim)
      .replace("export async function ", "async function ")
      .concat("\nmodule.exports = { getConsistentMachineId };\n");

  // esbuild emits an empty import_meta object for CJS, so its URL is undefined.
  writeFileSync(outputPath, cjs.replaceAll("import.meta.url", "undefined"));
}

describe("open-sse plain Node imports", () => {
  it("executes Cursor and machine identity after offline CJS emission", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "tokenproxy-open-sse-cjs-"));
    try {
      const cursorPath = join(outputDir, "cursor.cjs");
      const machinePath = join(outputDir, "machineId.cjs");
      renderCjsLoadProbe(join(repoRoot, "open-sse/executors/cursor.js"), cursorPath, { cursor: true });
      renderCjsLoadProbe(join(repoRoot, "open-sse/shared/machineId.js"), machinePath);

      const script = `
        const cursor = require(${JSON.stringify(cursorPath)});
        const machine = require(${JSON.stringify(machinePath)});
        machine.getConsistentMachineId("test-salt").then((id) => {
          if (typeof cursor.CursorExecutor !== "function" || !/^[a-f0-9]{16}$/.test(id)) process.exit(1);
        });
      `;
      const execution = spawnSync(process.execPath, ["-e", script], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_PATH: [join(repoRoot, "node_modules"), process.env.NODE_PATH]
            .filter(Boolean)
            .join(delimiter),
        },
      });
      expect(execution.status, execution.stderr).toBe(0);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("loads Cursor and machine identity as declared ESM without typeless reparsing", () => {
    const script = `
      const cursor = await import("./open-sse/executors/cursor.js");
      const machine = await import("./open-sse/shared/machineId.js");
      const id = await machine.getConsistentMachineId("test-salt");
      if (typeof cursor.CursorExecutor !== "function" || !/^[a-f0-9]{16}$/.test(id)) process.exit(1);
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toMatch(/MODULE_TYPELESS_PACKAGE_JSON[\s\S]*open-sse\//);
  });
});
