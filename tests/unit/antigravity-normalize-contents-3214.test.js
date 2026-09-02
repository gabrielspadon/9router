import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const credentials = {
  projectId: "synthetic-project",
  connectionId: "synthetic-connection",
};

describe("Antigravity thought-filtered conversation normalization", () => {
  it("merges same-role turns made adjacent when a thought-only turn is removed", () => {
    const output = new AntigravityExecutor().transformRequest("gemini-3.7-flash", {
      request: {
        contents: [
          { role: "user", parts: [{ text: "first user turn" }] },
          { role: "model", parts: [{ thought: true, text: "internal reasoning only" }] },
          { role: "user", parts: [{ text: "second user turn" }] },
          { role: "model", parts: [{ text: "visible reply" }] },
        ],
      },
    }, true, credentials);

    expect(output.request.contents).toEqual([
      {
        role: "user",
        parts: [{ text: "first user turn" }, { text: "second user turn" }],
      },
      { role: "model", parts: [{ text: "visible reply" }] },
    ]);
  });
});
