import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { UNREACHABLE_CHECKS_BEFORE_RESTART, WATCHDOG_INTERVAL_MS } from "../../src/lib/tunnel/shared/watchdogConfig.js";

const init = readFileSync(new URL("../../src/shared/services/initializeApp.js", import.meta.url), "utf8");
const manager = readFileSync(new URL("../../src/lib/tunnel/cloudflare/manager.js", import.meta.url), "utf8");
const barrel = readFileSync(new URL("../../src/lib/tunnel/index.js", import.meta.url), "utf8");

// The watchdog returned as soon as isCloudflaredRunning() was true, so a
// cloudflared that was up but not serving stayed down forever: PID alive =
// trusted. A capability is proven by exercising it, not by a live process.
describe("the tunnel watchdog tests reachability, not just a PID (#3412)", () => {
  it("no longer returns on a live process without probing", () => {
    expect(init).not.toContain("if (isCloudflaredRunning()) return;");
    expect(init).toContain("if (await isTunnelReachable())");
  });

  it("probes both the direct and the public URL, as enableTunnel does", () => {
    const fn = manager.slice(manager.indexOf("export async function isTunnelReachable"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("probeUrlAlive(existing.tunnelUrl)");
    expect(body).toContain("probeUrlAlive(publicUrl)");
  });

  it("lets the relay's answer repair the mapping instead of respawning", () => {
    // The public probe used to gate the return, so relay downtime restarted
    // cloudflared — which rotates the quick-tunnel URL and drops every client
    // already using it. The relay is a third party; its being down is not this
    // tunnel dying. The public result now drives re-registration, and the
    // direct probe alone decides whether the tunnel is serving (#1365).
    const fn = manager.slice(manager.indexOf("export async function isTunnelReachable"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("if (!publicOk) await tryRegister(");
    expect(body).toContain("return directOk;");
    expect(body).not.toContain("return directOk && publicOk");
  });

  it("treats a tunnel that was never established as nothing to test", () => {
    const fn = manager.slice(manager.indexOf("export async function isTunnelReachable"));
    expect(fn.slice(0, fn.indexOf("\n}"))).toContain("if (!existing?.tunnelUrl || !existing?.shortId) return true;");
  });

  it("requires sustained failure, so a blip cannot rotate the quick-tunnel URL", () => {
    expect(UNREACHABLE_CHECKS_BEFORE_RESTART).toBeGreaterThan(1);
    expect(init).toContain("svc.unreachableChecks < UNREACHABLE_CHECKS_BEFORE_RESTART");
    // A success must clear the counter, or an intermittent tunnel eventually
    // accumulates enough failures to be restarted anyway.
    expect(init).toContain("svc.unreachableChecks = 0;");
  });

  it("waits minutes, not hours, before acting", () => {
    const ms = UNREACHABLE_CHECKS_BEFORE_RESTART * WATCHDOG_INTERVAL_MS;
    expect(ms).toBeGreaterThanOrEqual(120000);
    expect(ms).toBeLessThanOrEqual(600000);
  });

  it("exports the probe through the tunnel barrel", () => {
    expect(barrel).toContain("isTunnelReachable");
    expect(barrel).toContain("UNREACHABLE_CHECKS_BEFORE_RESTART");
  });
});
