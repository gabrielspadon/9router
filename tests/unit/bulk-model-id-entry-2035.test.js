import { describe, it, expect } from "vitest";
import { parseModelIdList } from "@/shared/utils/providerCustomModels.js";

// The API key field has had a single/bulk toggle for a while; the model id
// field never did, so adding twenty ids meant twenty round trips through the
// form (#2035).
describe("pasting a list of model ids (#2035)", () => {
  it("splits on newlines and commas, trimming and dropping empties", () => {
    expect(parseModelIdList("a\nb,\n c \n\n")).toEqual(["a", "b", "c"]);
  });

  it("keeps a single id intact", () => {
    expect(parseModelIdList("  gpt-4o  ")).toEqual(["gpt-4o"]);
  });

  it("drops duplicates within the paste, keeping first position", () => {
    expect(parseModelIdList("a,b,a")).toEqual(["a", "b"]);
  });

  it("returns nothing for blank input", () => {
    expect(parseModelIdList("  \n , \n ")).toEqual([]);
    expect(parseModelIdList(undefined)).toEqual([]);
  });
});
