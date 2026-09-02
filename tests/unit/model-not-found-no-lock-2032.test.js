import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { ERROR_RULES } from "../../open-sse/config/errorConfig.js";

// A model the provider does not serve is a user-side name — a typo, or a
// vendor/model form the upstream spells differently. Locking the account fixes
// nothing and blocks every OTHER model on it, which is the reported lockout.
const REPORTED = '{"error":{"message":"The model `zai-org/GLM-5.2` does not exist","code":"model_not_found"}}';

describe("a wrong model name does not lock the account (#2032)", () => {
  it("passes the reported body through without a cooldown", () => {
    const r = checkFallbackError(404, REPORTED, 0);
    expect(r.shouldFallback).toBe(false);
    expect(r.cooldownMs).toBe(0);
  });

  it("covers the phrasings providers actually use", () => {
    for (const body of ["model_not_found", "Model not found", "unknown model: foo", "no such model"]) {
      expect(checkFallbackError(400, body, 0).shouldFallback, body).toBe(false);
    }
  });

  it("still locks on a bare 404, which is an endpoint problem not a model one", () => {
    const r = checkFallbackError(404, "", 0);
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });

  it("leaves the account-level failures alone", () => {
    expect(checkFallbackError(401, "invalid api key", 0).shouldFallback).toBe(true);
    expect(checkFallbackError(429, "rate limit exceeded", 0).newBackoffLevel).toBe(1);
  });

  it("does not match a bare 'does not exist', which is too generic", () => {
    // The reported body happens to contain it, but so could an unrelated error;
    // the rules stay model-specific and let the code field do the work.
    expect(ERROR_RULES.some((r) => r.text === "does not exist")).toBe(false);
    expect(checkFallbackError(429, "the queue does not exist", 0).shouldFallback).toBe(true);
  });

  it("sits above the status rules, since first match wins", () => {
    const textIdx = ERROR_RULES.findIndex((r) => r.text === "model_not_found");
    const statusIdx = ERROR_RULES.findIndex((r) => r.status === 404);
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(statusIdx).toBeGreaterThan(textIdx);
  });

  it("the Check message names the model, not the endpoint", async () => {
    // A 404 from /chat/completions has two causes. Saying "endpoint not found"
    // for both sent people checking their base URL when the model was wrong.
    const { readFileSync } = await import("node:fs");
    const route = readFileSync(new URL("../../src/app/api/provider-nodes/validate/route.js", import.meta.url), "utf8");
    expect(route).toContain("MODEL_NOT_FOUND");
    expect(route).toContain("this provider does not serve that model ID");
    // And the body has to reach the classifier, or it can never fire.
    expect(route).toContain("getChatErrorMessage(chatRes.status, await chatRes.text()");
    // A 404 with no such body still reports the endpoint.
    expect(route).toContain('if (status === 404) return "Chat endpoint not found";');
  });

  it("the Check classifier recognises the same phrasings as the rules", async () => {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync(new URL("../../src/app/api/provider-nodes/validate/route.js", import.meta.url), "utf8");
    const re = new RegExp(route.match(/const MODEL_NOT_FOUND = \/(.+?)\/i;/)[1], "i");
    for (const body of ["model_not_found", "unknown model", "no such model",
                        "The model `zai-org/GLM-5.2` does not exist"]) {
      expect(re.test(body), body).toBe(true);
    }
    expect(re.test("rate limit exceeded")).toBe(false);
  });
});
