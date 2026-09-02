import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sidebar = readFileSync(new URL("../../src/shared/components/Sidebar.js", import.meta.url), "utf8");
const route = readFileSync(new URL("../../src/app/api/version/update/route.js", import.meta.url), "utf8");
const handler = sidebar.slice(sidebar.indexOf("const handleUpdate ="), sidebar.indexOf("// Triggered by Copy button"));

// The backend updater works — /api/version/update spawns the detached updater
// and exits — but the sidebar's Update Now opened the manual Copy & Shutdown
// panel directly and never called it, so the automatic path was unreachable
// from the UI.
describe("Update Now starts the updater (#1120)", () => {
  it("calls the endpoint", () => {
    expect(handler).toContain('fetch("/api/version/update", { method: "POST" })');
  });

  it("keeps the manual panel as a fallback, not as the whole flow", () => {
    expect(handler).toContain("setManualUpdateFallback(true)");
    // Success returns early, so the fallback is only reached on failure.
    expect(handler).toContain("if (res.ok && data.success) return;");
  });

  it("falls back when the request throws, not only when it returns badly", () => {
    expect(handler).toMatch(/catch\s*{[^}]*}\s*\n\s*setManualUpdateFallback\(true\)/s);
  });

  it("does not show manual instructions while the automatic update runs", () => {
    // Telling the user to install by hand during an install is the bug in
    // reverse.
    expect(sidebar).toContain("isUpdating && !manualUpdateFallback && !isDisconnected ?");
    expect(sidebar).toContain("Updating TokenProxy");
  });

  it("still reaches the manual panel on the fallback path", () => {
    expect(sidebar).toContain("isUpdating || manualUpdateFallback ?");
  });

  it("the endpoint really refuses outside production, which is why a fallback is needed", () => {
    expect(route).toContain('process.env.NODE_ENV !== "production"');
    expect(route).toContain("spawnUpdaterAndExit()");
  });
});
