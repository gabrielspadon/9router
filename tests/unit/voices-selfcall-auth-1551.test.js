import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const voices = readFileSync(new URL("../../src/app/api/v1/audio/voices/route.js", import.meta.url), "utf8");
const ping = readFileSync(new URL("../../src/app/api/models/test/ping.js", import.meta.url), "utf8");
const guard = readFileSync(new URL("../../src/dashboardGuard.js", import.meta.url), "utf8");

// /v1/audio/voices answers by self-calling /api/media-providers/... over
// loopback. That path sits behind the dashboard deny-by-default, and a
// server-side fetch carries no session cookie, so the call 401'd whenever
// requireLogin was on — which is exactly when the endpoint should work.
describe("the voices self-call authenticates itself (#1551)", () => {
  it("presents the internal CLI token", () => {
    expect(voices).toContain('"x-tp-cli-token"');
    expect(voices).toContain("getConsistentMachineId(CLI_TOKEN_SALT)");
  });

  it("uses the same salt as the other internal self-calls", () => {
    const salt = (src) => src.match(/CLI_TOKEN_SALT = "([^"]+)"/)?.[1];
    expect(salt(voices)).toBeTruthy();
    expect(salt(voices)).toBe(salt(ping));
  });

  it("keeps the loopback origin, which is the SSRF defence", () => {
    // The origin must not come from the Host header: a forged one would aim
    // this server-side fetch at an attacker-chosen host.
    expect(voices).toContain("http://127.0.0.1:${process.env.PORT");
    expect(voices).not.toMatch(/headers\.get\(["']host["']\)/);
  });

  it("the target really is behind the deny-by-default, which is why this mattered", () => {
    expect(guard).toContain('"/api/media-providers"');
    expect(guard).toContain("Deny-by-default for /api/*");
  });
});
