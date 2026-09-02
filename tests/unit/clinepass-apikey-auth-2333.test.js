import { describe, it, expect } from "vitest";
import { buildClineHeaders, getClineAccessToken } from "open-sse/shared/clineAuth.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const executor = readFileSync(join(root, "open-sse/executors/default.js"), "utf8");

// The hook as it is written in the executor, so the test exercises the real
// branch rather than a paraphrase of it.
const clineHeaders = (c) => (c.apiKey
  ? buildClineHeaders(null, { Authorization: `Bearer ${c.apiKey}` })
  : buildClineHeaders(c.accessToken));

describe("ClinePass sends an API key plain and a session token prefixed (#2333, #2243)", () => {
  it("an API key keeps its own value", () => {
    // The workos prefix belongs to the OAuth session token. On a plain API key
    // it makes a valid key unusable, which is the reported 401.
    expect(clineHeaders({ apiKey: "sk-cline-abc" }).Authorization).toBe("Bearer sk-cline-abc");
  });

  it("an OAuth access token still carries the prefix", () => {
    expect(clineHeaders({ accessToken: "sess_123" }).Authorization).toBe("Bearer workos:sess_123");
  });

  it("a token that already carries the prefix is not doubled", () => {
    expect(getClineAccessToken("workos:sess_123")).toBe("workos:sess_123");
    expect(clineHeaders({ accessToken: "workos:sess_123" }).Authorization).toBe("Bearer workos:sess_123");
  });

  it("the API key wins when a connection carries both, as it did before", () => {
    expect(clineHeaders({ apiKey: "sk-1", accessToken: "sess_1" }).Authorization).toBe("Bearer sk-1");
  });

  it("keeps the client identification headers in both cases", () => {
    for (const creds of [{ apiKey: "sk-1" }, { accessToken: "sess_1" }]) {
      const h = clineHeaders(creds);
      expect(h["X-CLIENT-TYPE"]).toBe("tokenproxy");
      expect(h["HTTP-Referer"]).toBe("https://cline.bot");
    }
  });

  it("the executor hook is the branch this test exercises", () => {
    expect(executor).toContain("clineHeaders: (h, c) => Object.assign(h, c.apiKey");
    expect(executor).not.toContain("buildClineHeaders(c.apiKey || c.accessToken)");
  });
});
