import { describe, expect, it } from "vitest";

import "./registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";

describe("null content parts", () => {
  it.each([
    ["OpenAI", FORMATS.OPENAI, null],
    ["Claude", FORMATS.CLAUDE, "claude"],
    ["Kiro", FORMATS.KIRO, "kiro"],
  ])("drops null parts without media stripping before the %s translator", (_name, targetFormat, provider) => {
    const body = {
      messages: [{
        role: "user",
        content: [
          null,
          { type: "text", text: "keep this text" },
        ],
      }],
    };

    expect(() => translateRequest(
      FORMATS.OPENAI,
      targetFormat,
      "m",
      body,
      true,
      null,
      provider,
    )).not.toThrow();
    expect(body.messages[0].content).toEqual([{ type: "text", text: "keep this text" }]);
  });

  it("drops null content parts before OpenAI strip handling", () => {
    const body = {
      messages: [{
        role: "user",
        content: [
          null,
          { type: "text", text: "keep this text" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        ],
      }],
    };

    const result = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "m",
      body,
      true,
      null,
      null,
      null,
      ["image"],
    );

    expect(result.messages[0].content).toEqual([{ type: "text", text: "keep this text" }]);
  });
});
