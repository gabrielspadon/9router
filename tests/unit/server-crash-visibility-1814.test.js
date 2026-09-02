import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../custom-server.js", import.meta.url), "utf8");

// A crash in the server process was silent from the operator's side: Node
// prints its own message and exits, nothing identified which process died, and
// the tray's auto-restart made the visible symptom an unexplained blip. The
// report that follows carries no output at all (#1814).
describe("a crash in the server process says so (#1814)", () => {
  it("both crash events are handled", () => {
    expect(src).toContain('process.on("uncaughtException"');
    expect(src).toContain('process.on("unhandledRejection"');
  });

  it("each one still exits, because installing a listener suppresses Node's default", () => {
    // Continuing past an unknown exception is how a gateway starts answering
    // with corrupted state. The handlers add a log, not a survival mode.
    const ue = src.indexOf('process.on("uncaughtException"');
    const ur = src.indexOf('process.on("unhandledRejection"');
    expect(src.slice(ue, ue + 900)).toContain("process.exit(1)");
    expect(src.slice(ur, ur + 900)).toContain("process.exit(1)");
  });

  it("a client that walked away does not take the server down", () => {
    // Those rejections are already a non-event on the handler path; reaching
    // the process handler must not turn one into an outage.
    const ur = src.indexOf('process.on("unhandledRejection"');
    const body = src.slice(ur, ur + 900);
    expect(body).toContain("isClientDisconnect(reason)");
    expect(body.indexOf("isClientDisconnect(reason)")).toBeLessThan(body.indexOf("process.exit(1)"));
  });

  it("the message identifies the process and the port", () => {
    expect(src).toContain("in the server process (pid ${process.pid}");
    expect(src).toContain("process.env.PORT");
  });

  it("the port is read at crash time, not closed over", () => {
    // It is assigned later in this file than the handlers are installed, and a
    // crash handler that throws is worse than no handler at all.
    expect(src).not.toMatch(/\$\{PORT\}/);
    const d = src.indexOf("function describeCrash");
    expect(src.slice(d, d + 700)).toContain("process.env.PORT ?");
  });

  it("a non-Error rejection is described rather than dropped", () => {
    // A rejected string or object has no stack; the log must still say what it
    // was, or the handler reintroduces the silence it exists to remove.
    const d = src.indexOf("function describeCrash");
    const body = src.slice(d, d + 700);
    expect(body).toContain("error instanceof Error");
    expect(body).toContain("String(error)");
  });
});
