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
    }, "m", "claude-cli");

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
    }, "m", "claude-cli", true);

    expect(result?.success).toBe(true);
    expect(await responseText(result)).toContain("isNewTopic");
  });
});
