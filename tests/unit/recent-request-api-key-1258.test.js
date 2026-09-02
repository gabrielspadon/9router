import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildRecentRequestRow } from "../../src/lib/db/repos/usageRepo.js";

const ui = readFileSync(new URL("../../src/shared/components/UsageStats.js", import.meta.url), "utf8");

// usageHistory already carried the apiKey and the ring buffer already selected
// it, so the value reached buildRecentRequestRow and was dropped. The consumer
// was not waiting on it either, so this needed both halves to be worth anything.
describe("recent requests show which key served them (#1258)", () => {
  it("forwards the key", () => {
    const row = buildRecentRequestRow({ apiKey: "sk-abcdefghijklmnop", model: "m", tokens: {} });
    expect(row.apiKey).toBeTruthy();
  });

  it("masks it, and never returns the raw key", () => {
    const raw = "sk-abcdefghijklmnop";
    const row = buildRecentRequestRow({ apiKey: raw, model: "m", tokens: {} });
    expect(row.apiKey).toBe("sk-abcde***");
    expect(row.apiKey).not.toBe(raw);
    expect(raw.startsWith(row.apiKey.replace("***", ""))).toBe(true);
    expect(row.apiKey.length).toBeLessThan(raw.length);
  });

  it("masks a short key without exposing all of it", () => {
    expect(buildRecentRequestRow({ apiKey: "abc", tokens: {} }).apiKey).toBe("a***");
  });

  it("reports null for a request that carried no key", () => {
    expect(buildRecentRequestRow({ tokens: {} }).apiKey).toBeNull();
    expect(buildRecentRequestRow({ apiKey: "", tokens: {} }).apiKey).toBeNull();
    expect(buildRecentRequestRow({ apiKey: 12345, tokens: {} }).apiKey).toBeNull();
  });

  it("masks at the repo, not the view, so the API response carries no raw key", () => {
    const repo = readFileSync(new URL("../../src/lib/db/repos/usageRepo.js", import.meta.url), "utf8");
    const fn = repo.slice(repo.indexOf("export function buildRecentRequestRow"));
    expect(fn.slice(0, fn.indexOf("\n}"))).toContain("apiKey: maskApiKey(e.apiKey)");
  });

  it("renders a column, not just a tooltip", () => {
    expect(ui).toContain(">Key</th>");
    expect(ui).toContain("{r.apiKey || \"—\"}");
  });

  it("keeps the other row fields intact", () => {
    const row = buildRecentRequestRow({
      apiKey: "sk-abcdefghijklmnop", model: "m", provider: "p",
      tokens: { prompt_tokens: 5, completion_tokens: 7 }, status: "ok", timestamp: 1,
    });
    expect(row).toMatchObject({ model: "m", provider: "p", promptTokens: 5, completionTokens: 7, status: "ok" });
  });
});
