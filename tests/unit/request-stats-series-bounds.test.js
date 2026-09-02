import { describe, expect, it } from "vitest";
import { seriesBounds } from "@/lib/db/repos/requestStatsRepo.js";

describe("seriesBounds", () => {
  it("handles a large real-history timestamp set without spreading it into a call", () => {
    const times = Array.from({ length: 200_000 }, (_, index) => index * 60_000);

    expect(seriesBounds(times)).toEqual({ min: 0, max: 11_999_940_000 });
  });
});
