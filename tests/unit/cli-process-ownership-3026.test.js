import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLI_SOURCE = fileURLToPath(new URL("../../cli", import.meta.url));

function waitForLine(child, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("fixture server did not report its port")), timeoutMs);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/^(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`fixture server exited before listening (${code})`));
    });
  });
}

function waitForExit(child, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("launcher did not exit after detecting an occupied port")), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stop(child) {
  if (!child?.pid || !isAlive(child.pid)) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 500)),
  ]);
  if (isAlive(child.pid)) child.kill("SIGKILL");
}

async function makeLauncherCopy(root) {
  const launcherDir = join(root, "launcher");
  await cp(CLI_SOURCE, launcherDir, { recursive: true, filter: (source) => !source.includes("/node_modules/") });

  // The launcher only needs this marker to avoid an npm install before its
  // ownership check. The fixture server is deliberately plain Node HTTP.
  await mkdir(join(launcherDir, "app", "node_modules", "sql.js", "dist"), { recursive: true });
  await writeFile(join(launcherDir, "app", "node_modules", "sql.js", "dist", "sql-wasm.wasm"), "fixture");
  await writeFile(join(launcherDir, "app", "custom-server.js"), [
    'const http = require("http");',
    "const server = http.createServer((request, response) => { response.statusCode = 404; response.end(\"fixture\"); });",
    "server.listen(Number(process.env.PORT), \"127.0.0.1\");",
    "process.on(\"SIGTERM\", () => server.close(() => process.exit(0)));",
  ].join("\n"));
  return launcherDir;
}

async function makeLegacyProcessTools(root, pid) {
  const binDir = join(root, "bin");
  await mkdir(binDir, { recursive: true });
  const ps = join(binDir, "ps");
  const lsof = join(binDir, "lsof");
  await writeFile(ps, `#!/bin/sh\nprintf '%s\\n' 'fixture ${pid} 0.0 0.0 node fixture next-server'\n`);
  await writeFile(lsof, "#!/bin/sh\nexit 0\n");
  await chmod(ps, 0o755);
  await chmod(lsof, 0o755);
  return binDir;
}

async function startNamedHttpFixture(handler) {
  const fixtureScript = [
    'const http = require("http");',
    "let timer;",
    `const server = http.createServer((request, response) => { ${handler} });`,
    "server.listen(0, \"127.0.0.1\", () => process.stdout.write(String(server.address().port)));",
    "process.on(\"SIGTERM\", () => { clearInterval(timer); server.close(() => process.exit(0)); });",
  ].join("\n");
  const child = spawn(process.execPath, ["-e", fixtureScript, "next-server"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { child, port: await waitForLine(child) };
}

async function startIsolatedLauncher(root, fixturePid, args) {
  const launcherDir = await makeLauncherCopy(root);
  const binDir = await makeLegacyProcessTools(root, fixturePid);
  const dataDir = join(root, "data");
  await mkdir(join(dataDir, "runtime", "node_modules", "systray2"), { recursive: true });
  await writeFile(join(dataDir, "runtime", "node_modules", "systray2", "package.json"), "{}");
  return spawn(process.execPath, [join(launcherDir, "cli.js"), ...args], {
    env: { ...process.env, DATA_DIR: dataDir, PATH: `${binDir}:${process.env.PATH}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Before the ownership probe, ordinary startup ran `ps aux` and killed every
// `next-server` it found. This real process has that broad-match name but its
// generic health body is not TokenProxy's `{ ok: true }` liveness signature. The
// launcher must leave it alone.
describe("CLI process ownership (#3026)", () => {
  it("does not kill a next-server-named local HTTP process that fails TokenProxy liveness signature", async () => {
    const fixture = await startNamedHttpFixture("response.setHeader(\"content-type\", \"application/json\"); response.end(JSON.stringify({ service: \"other\" }));");
    let launcher;
    let root;

    try {
      root = await mkdtemp(join(tmpdir(), "tokenproxy-cli-ownership-"));
      launcher = await startIsolatedLauncher(root, fixture.child.pid, ["--port", String(fixture.port), "--no-browser", "--skip-update"]);
      let stderr = "";
      launcher.stderr.on("data", (chunk) => { stderr += chunk; });

      await expect(waitForExit(launcher)).resolves.toMatchObject({ code: 1, signal: null });
      expect(stderr).toContain(`Port ${fixture.port} is already in use by a non-TokenProxy process.`);
      expect(isAlive(fixture.child.pid)).toBe(true);
    } finally {
      await stop(launcher);
      await stop(fixture.child);
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  it("bounds a byte-drip health response instead of waiting indefinitely", async () => {
    const fixture = await startNamedHttpFixture('response.writeHead(200, { "content-type": "application/json" }); response.write("{"); timer = setInterval(() => response.write(" "), 50);');
    let launcher;
    let root;

    try {
      root = await mkdtemp(join(tmpdir(), "tokenproxy-cli-deadline-"));
      launcher = await startIsolatedLauncher(root, fixture.child.pid, ["--port", String(fixture.port), "--no-browser", "--skip-update"]);
      await expect(waitForExit(launcher, 1400)).resolves.toMatchObject({ code: 1, signal: null });
      expect(isAlive(fixture.child.pid)).toBe(true);
    } finally {
      await stop(launcher);
      await stop(fixture.child);
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  it("stop does not kill a next-server process outside its selected port", async () => {
    const fixture = await startNamedHttpFixture("response.end(\"other server\");");
    let launcher;
    let root;

    try {
      root = await mkdtemp(join(tmpdir(), "tokenproxy-cli-stop-"));
      const selectedPort = fixture.port === 65535 ? fixture.port - 1 : fixture.port + 1;
      launcher = await startIsolatedLauncher(root, fixture.child.pid, ["stop", "--port", String(selectedPort)]);
      await expect(waitForExit(launcher)).resolves.toMatchObject({ code: 0, signal: null });
      expect(isAlive(fixture.child.pid)).toBe(true);
    } finally {
      await stop(launcher);
      await stop(fixture.child);
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  it("takeover rejects an unknown port owner without waiting to replace it", async () => {
    const fixture = await startNamedHttpFixture("response.setHeader(\"content-type\", \"application/json\"); response.end(JSON.stringify({ service: \"other\" }));");
    let launcher;
    let root;

    try {
      root = await mkdtemp(join(tmpdir(), "tokenproxy-cli-takeover-"));
      launcher = await startIsolatedLauncher(root, fixture.child.pid, ["--takeover", "--port", String(fixture.port), "--no-browser", "--skip-update"]);
      await expect(waitForExit(launcher, 1400)).resolves.toMatchObject({ code: 1, signal: null });
      expect(isAlive(fixture.child.pid)).toBe(true);
    } finally {
      await stop(launcher);
      await stop(fixture.child);
      if (root) await rm(root, { recursive: true, force: true });
    }
  });
});
