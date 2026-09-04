import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../custom-server.js", import.meta.url), "utf8");

// The graceful-shutdown hooks had no test. Deleting both of them left the whole
// suite green: the only two files that mention custom-server.js alongside these
// signals turned out to be doing something else. cli-process-ownership-3026
// WRITES ITS OWN custom-server.js fixture and asserts against that copy, and
// smoke.mjs uses SIGTERM to tear a child down rather than to assert anything.
//
// This is a source-text guard and its ceiling is worth stating: it proves the
// registration is present and single-owner, not that the shutdown path drains
// correctly. Draining is covered by shutdown-flushers.test.js, which spawns a
// real process. What was missing is the link between the two -- that
// custom-server.js actually arms the signal that triggers any of it.
describe("the server arms its graceful-shutdown signals", () => {
  it("registers both termination signals", () => {
    expect(src).toContain("process.once('SIGINT', stop)");
    expect(src).toContain("process.once('SIGTERM', stop)");
  });

  it("uses once, so a second signal cannot re-enter a shutdown already running", () => {
    // `on` would let a repeated Ctrl-C run stop() concurrently with itself,
    // which is how a half-drained flush becomes a corrupt one.
    expect(src).not.toContain("process.on('SIGINT', stop)");
    expect(src).not.toContain("process.on('SIGTERM', stop)");
  });

  it("both signals resolve to the same handler, so neither path is unhandled", () => {
    const sigint = src.indexOf("process.once('SIGINT',");
    const sigterm = src.indexOf("process.once('SIGTERM',");
    expect(sigint).toBeGreaterThan(-1);
    expect(sigterm).toBeGreaterThan(-1);
    expect(src.slice(sigint, sigint + 40)).toContain("stop");
    expect(src.slice(sigterm, sigterm + 40)).toContain("stop");
  });
});
