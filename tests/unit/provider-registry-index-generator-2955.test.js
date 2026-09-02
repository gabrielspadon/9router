import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDirectory, "../..");
const generator = join(repoRoot, "scripts/generate-registry-index.mjs");
const temporaryRoots = [];

function runGenerator(registryDirectory, ...args) {
  return spawnSync(process.execPath, [generator, "--registry-dir", registryDirectory, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function createRegistryFixture(files) {
  const root = mkdtempSync(join(tmpdir(), "tokenproxy-registry-index-"));
  const registryDirectory = join(root, "registry");
  temporaryRoots.push(root);
  mkdirSync(registryDirectory);

  for (const [filename, source] of Object.entries(files)) {
    writeFileSync(join(registryDirectory, filename), source, "utf8");
  }

  return registryDirectory;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("deterministic provider-registry index generator (#2955)", () => {
  it("writes a lexical static registry and keeps disabled providers inactive", async () => {
    const registryDirectory = createRegistryFixture({
      "beta.js": 'export default { id: "beta" };\n',
      "alpha.js": 'export default { id: "alpha" };\n',
      "devin-cli.js": 'export default { id: "devin-cli" };\n',
      "trae.js": 'export default { id: "trae" };\n',
      "windsurf.js": 'export default { id: "windsurf" };\n',
      "index.js": 'export default ["stale"];\n',
      "ignored.txt": "not a registry module\n",
    });

    const generated = runGenerator(registryDirectory);

    expect(generated.status).toBe(0);
    const indexSource = readFileSync(join(registryDirectory, "index.js"), "utf8");
    expect(indexSource.indexOf('from "./alpha.js"')).toBeLessThan(indexSource.indexOf('from "./beta.js"'));
    expect(indexSource).toContain("Disabled: no tool calling support");
    const registry = (await import(`${pathToFileURL(join(registryDirectory, "index.js")).href}?${Date.now()}`)).default;
    expect(registry.map((entry) => entry.id)).toEqual(["alpha", "beta"]);
  });

  it("reports drift without overwriting it, then repairs to a checkable index", () => {
    const registryDirectory = createRegistryFixture({
      "alpha.js": 'export default { id: "alpha" };\n',
      "beta.js": 'export default { id: "beta" };\n',
    });
    const indexPath = join(registryDirectory, "index.js");

    writeFileSync(indexPath, "export default [];\n", "utf8");
    const drifted = runGenerator(registryDirectory, "--check");

    expect(drifted.status).toBe(1);
    expect(drifted.stderr).toContain("out of date");
    expect(readFileSync(indexPath, "utf8")).toBe("export default [];\n");

    expect(runGenerator(registryDirectory).status).toBe(0);
    expect(runGenerator(registryDirectory, "--check").status).toBe(0);
  });

  it("treats a missing index as drift and can create it", () => {
    const registryDirectory = createRegistryFixture({
      "alpha.js": 'export default { id: "alpha" };\n',
    });

    const missing = runGenerator(registryDirectory, "--check");

    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("out of date");
    expect(runGenerator(registryDirectory).status).toBe(0);
    expect(runGenerator(registryDirectory, "--check").status).toBe(0);
  });

  it("checks the tracked registry index and leaves repeated generation byte-stable", () => {
    const registryDirectory = join(repoRoot, "open-sse/providers/registry");
    const indexPath = join(registryDirectory, "index.js");
    const before = readFileSync(indexPath, "utf8");

    expect(runGenerator(registryDirectory, "--check").status).toBe(0);
    expect(runGenerator(registryDirectory).status).toBe(0);
    expect(readFileSync(indexPath, "utf8")).toBe(before);
  });
});
