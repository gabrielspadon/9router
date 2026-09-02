import { describe, expect, it } from "vitest";
import { CLI_TOOLS } from "@/shared/constants/cliTools.js";

describe("Claude CLI legacy default models (#2645)", () => {
  it("uses canonical bare Claude ids for every configured role", () => {
    const defaults = Object.fromEntries(
      CLI_TOOLS.claude.defaultModels.map(({ id, defaultValue }) => [id, defaultValue]),
    );

    expect(defaults).toEqual({
      fable: "claude-fable-5",
      opus: "claude-opus-5",
      sonnet: "claude-sonnet-5",
      haiku: "claude-haiku-4-5-20251001",
    });
  });
});
