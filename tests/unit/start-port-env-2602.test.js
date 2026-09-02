import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const server = readFileSync(new URL("../../custom-server.js", import.meta.url), "utf8");

// The start script passed --port 20127, and a CLI flag beats the PORT
// environment variable, so setting PORT in .env or pm2 did nothing and the
// server always came up on 20127 whatever the operator asked for.
describe("PORT governs the production start (#2602)", () => {
  it("the start script no longer pins a port", () => {
    expect(pkg.scripts.start).toBe("node custom-server.js");
    expect(pkg.scripts.start).not.toContain("--port");
  });

  it("custom-server forwards argv, which is why the flag won", () => {
    // Pinned so the reason this mattered is not lost: anything on argv reaches
    // `next start` and outranks the environment.
    expect(server).toContain("process.argv.slice(2)");
  });

  it("defaults to the documented port only when PORT is unset", () => {
    // Every assignment to process.env.PORT must be guarded, or an explicit value
    // set by the operator would be clobbered by the default.
    const assigns = server.split("\n").filter((l) => /process\.env\.PORT\s*=/.test(l));
    expect(assigns.length).toBeGreaterThan(0);
    for (const line of assigns) {
      expect(line, `unguarded assignment: ${line.trim()}`).toMatch(/if\s*\(!process\.env\.PORT\)/);
    }
  });

  it("defaults to 20128, the documented port, not the old 20127", () => {
    const line = server.split("\n").find((l) => l.includes("process.env.PORT ="));
    expect(line).toContain("20128");
    expect(line).not.toContain("20127");
  });

  it("leaves the dev scripts on their own documented port", () => {
    // next dev would fall back to 3000 without the flag, and 20127 for dev is
    // deliberate; only the production path was overriding the operator.
    expect(pkg.scripts.dev).toContain("--port 20127");
  });
});
