import { describe, expect, it } from "vitest";

import { handleBypassRequest } from "../../open-sse/utils/bypassHandler.js";

async function responseText(result) {
  return result.response.text();
}

describe("bypass handler null content parts", () => {
  it("ignores a null user content part while detecting Warmup", async () => {
    const result = handleBypassRequest({
      messages: [{
        role: "user",
        content: [null, { type: "text", text: "Warmup" }],
      }],
      stream: true,
    }, "m");

    expect(result?.success).toBe(true);
    expect(await responseText(result)).toContain("CLI Command Execution: Clear Terminal");
  });

  it("ignores a null system content part while detecting a naming request", async () => {
    const result = handleBypassRequest({
      messages: [{
        role: "user",
        content: [{ type: "text", text: "organize report" }],
      }],
      system: [null, { type: "text", text: "Return isNewTopic when appropriate" }],
      stream: true,
    }, "m", true);

    expect(result?.success).toBe(true);
    expect(await responseText(result)).toContain("isNewTopic");
  });
});

describe("bypass handler treats the request shape the same for any client", () => {
  it("bypasses a Warmup probe with no user-agent involved at all", async () => {
    // The gate used to be `userAgent.includes("claude-cli")`, so the exact
    // same body from any other harness (or from no identified harness at
    // all, since the parameter is gone) skipped the real provider call.
    // Detection is on body content only now, so there is nothing left to
    // vary by identity.
    const result = handleBypassRequest({
      messages: [{ role: "user", content: "Warmup" }],
      stream: false,
    }, "m");

    expect(result?.success).toBe(true);
    expect(await responseText(result)).toContain("CLI Command Execution: Clear Terminal");
  });

  it("bypasses a bare count probe regardless of what called it", async () => {
    const result = handleBypassRequest({
      messages: [{ role: "user", content: "count" }],
      stream: false,
    }, "m");

    expect(result?.success).toBe(true);
  });

  it("leaves an ordinary multi-message conversation alone", async () => {
    // Guards against the fix over-matching: only the exact no-op shapes
    // bypass, not any request that happens to mention these words.
    const result = handleBypassRequest({
      messages: [
        { role: "user", content: "Please count the items in this list for me" },
        { role: "assistant", content: "Sure, let me look." },
        { role: "user", content: "Go ahead" },
      ],
      stream: false,
    }, "m");

    expect(result).toBeNull();
  });
});
