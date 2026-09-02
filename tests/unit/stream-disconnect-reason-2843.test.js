import { describe, expect, it } from "vitest";
import {
  createStreamController,
  pipeWithDisconnect,
} from "../../open-sse/utils/streamHandler.js";
import { createSseTerminalObserver } from "../../open-sse/utils/streamTerminal.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Upstream #2843: the DISCONNECT line printed the runtime's raw cancel reason
// ("ResponseAborted", a Next.js Error with an empty message) and nothing else,
// so a report could not say whether the answer had already been delivered.
function makeController(overrides = {}) {
  const lines = [];
  const controller = createStreamController({
    log: { line: (_tag, _symbol, msg) => lines.push(msg) },
    provider: "claude",
    model: "claude-fable-5",
    ...overrides,
  });
  return { controller, lines };
}

class ResponseAborted extends Error {
  constructor() {
    super();
    this.name = "ResponseAborted";
  }
}

describe("disconnect reason reporting (#2843)", () => {
  it("names an Error reason instead of stringifying the object", () => {
    const { controller, lines } = makeController();
    controller.handleDisconnect(new ResponseAborted());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("DISCONNECT: ResponseAborted");
    expect(lines[0]).not.toContain("[object Object]");
    expect(lines[0]).toContain("claude/claude-fable-5");
  });

  it("keeps the default reason when nothing is supplied", () => {
    const { controller, lines } = makeController();
    controller.handleDisconnect();
    expect(lines[0]).toContain("DISCONNECT: client_closed");
  });

  it("normalises a DOMException-style reason to name and message", () => {
    const { controller, lines } = makeController();
    controller.handleDisconnect(
      new DOMException("This operation was aborted", "AbortError"),
    );
    expect(lines[0]).toContain("DISCONNECT: AbortError: This operation was aborted");
  });

  it("bounds the reason so an attached payload cannot flood the log", () => {
    const { controller, lines } = makeController();
    controller.handleDisconnect("x".repeat(5000));
    const reason = lines[0].split(" · ")[0].replace("DISCONNECT: ", "");
    expect(reason.length).toBe(120);
  });

  it("passes the raw reason through to onDisconnect unchanged", () => {
    const seen = [];
    const reason = new ResponseAborted();
    const { controller } = makeController({ onDisconnect: (info) => seen.push(info) });
    controller.handleDisconnect(reason);
    expect(seen).toHaveLength(1);
    expect(seen[0].reason).toBe(reason);
    expect(typeof seen[0].duration).toBe("number");
  });

  it("renders progress detail as counters only", () => {
    const { controller, lines } = makeController();
    controller.handleDisconnect("cancelled", { up: "3c/120b", terminal: "no", skipped: null });
    expect(lines[0]).toContain("DISCONNECT: cancelled · up=3c/120b · terminal=no");
    expect(lines[0]).not.toContain("skipped");
  });

  it("reports upstream progress and terminal state when the runtime cancels the response", async () => {
    const { controller, lines } = makeController();
    const upstream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      },
      pull() {
        // stay open so the cancel path runs instead of normal completion
        return new Promise(() => {});
      },
    });

    const out = pipeWithDisconnect(
      { body: upstream },
      new TransformStream(),
      controller,
      {
        terminalObserver: createSseTerminalObserver(FORMATS.OPENAI),
        stallTimeoutMs: 60000,
        ttftTimeoutMs: 60000,
        keepaliveMs: 0,
      },
    );

    const reader = out.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("[DONE]");

    await reader.cancel(new ResponseAborted());

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("DISCONNECT: ResponseAborted");
    expect(lines[0]).toContain("up=1c/14b");
    expect(lines[0]).toContain("terminal=yes");
  });
});
