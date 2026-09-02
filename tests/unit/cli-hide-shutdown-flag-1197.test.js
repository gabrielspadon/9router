import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../cli/cli.js", import.meta.url), "utf8");

// The tray "hide" handoff kills the foreground server so the backgrounded
// process can claim the port. cleanup() SIGKILLs it, and the server "close"
// handler restarts unless isShuttingDown is set — so the hide path spawned a
// replacement next-server that raced the background process for the port and
// orphaned itself holding it.
describe("the hide handoff does not resurrect the server it just killed (#1197)", () => {
  it("sets the shutdown flag before cleanup on the hide path", () => {
    const hide = src.indexOf("is now running in background");
    expect(hide).toBeGreaterThan(0);
    const branch = src.slice(hide, src.indexOf('choice === "exit"', hide));
    const flag = branch.indexOf("isShuttingDown = true;");
    const kill = branch.indexOf("cleanup();");
    expect(flag, "the hide branch never sets isShuttingDown").toBeGreaterThan(-1);
    expect(kill).toBeGreaterThan(flag);
  });

  it("the exit path still does the same thing, in the same order", () => {
    const exitIdx = src.indexOf('choice === "exit"');
    const branch = src.slice(exitIdx, exitIdx + 260);
    expect(branch.indexOf("isShuttingDown = true;")).toBeGreaterThan(-1);
    expect(branch.indexOf("cleanup();")).toBeGreaterThan(branch.indexOf("isShuttingDown = true;"));
  });

  it("the restart really is gated on that flag, which is why it matters", () => {
    expect(src).toContain("if (!isShuttingDown) tryRestart();");
    expect(src).toContain("if (isShuttingDown || code === 0)");
  });

  it("every deliberate shutdown path sets it", () => {
    // SIGINT, SIGTERM and the two menu choices. A path that kills the server
    // without the flag reintroduces this bug.
    const count = (src.match(/isShuttingDown = true;/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(4);
  });
});
