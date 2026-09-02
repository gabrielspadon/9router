import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DefaultExecutor } from "open-sse/executors/default.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const executor = read("../../open-sse/executors/default.js");
const route = read("../../src/app/api/providers/route.js");
const modal = read("../../src/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js");

// Stacking local proxies that need no credential was impossible: both the modal
// and the API demanded an API key, so the user typed a dummy one, and TokenProxy
// then sent that dummy upstream — the opposite of "explicitly not send a key"
// (#1523). With no credential at all the combined auth path sent the literal
// string "Bearer undefined".
describe("a compatible endpoint can be addressed with no API key (#1523)", () => {
  it("no Authorization header is sent when there is no credential", () => {
    expect(executor).toContain("const token = credentials.apiKey || credentials.accessToken;");
    expect(executor).toContain("if (token) setAuth(headers, desc, token);");
    // The old unconditional call must be gone, or the guard above is dead code.
    expect(executor).not.toContain("setAuth(headers, desc, credentials.apiKey || credentials.accessToken);");
  });

  it("a present credential still sets the header", () => {
    // The change is narrowed to the both-absent case; nothing about a real
    // token's path may move.
    expect(executor).toContain("if (credentials.apiKey) setAuth(headers, desc.apiKey, credentials.apiKey);");
    expect(executor).toContain("else if (credentials.accessToken) setAuth(headers, desc.oauth, credentials.accessToken);");
  });

  it("the API exempts only the compatible prefixes and ollama-local", () => {
    expect(route).toContain("const allowsEmptyApiKey =");
    expect(route).toContain("isOpenAICompatibleProvider(provider) ||");
    expect(route).toContain("isAnthropicCompatibleProvider(provider);");
    expect(route).toContain("if (!apiKey && !allowsEmptyApiKey) {");
    // A named provider with an empty key is still rejected.
    expect(route).not.toContain('if (!apiKey && provider !== "ollama-local") {');
  });

  it("the modal stops blocking submit and says the field is optional", () => {
    expect(modal).toContain("if (!isOllamaLocal && !isCompatible && !formData.apiKey) return;");
    expect(modal).toContain("`${credentialLabel} (optional)`");
    expect(modal).toContain("Leave empty for an endpoint that needs no key");
  });

  it("behaviour: a credential-less provider gets no Authorization header at all", () => {
    // mmf declares transport.noAuth and the golden test passes it {} on purpose,
    // yet the recorded header was "Bearer undefined" — the golden's sanitizer
    // rewrites any Authorization value to "Bearer <TOK>", so the bug was
    // invisible in the snapshot for as long as it existed.
    const headers = new DefaultExecutor("mmf").buildHeaders({}, true);
    expect(headers.Authorization).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("behaviour: a real key still produces the header", () => {
    const headers = new DefaultExecutor("mmf").buildHeaders({ apiKey: "sk-real" }, true);
    expect(headers.Authorization).toBe("Bearer sk-real");
  });

  it("the name is still required for a non-ollama connection", () => {
    // Splitting the disabled expression must not have dropped the name check.
    expect(modal).toContain("(!isOllamaLocal && !formData.name) ||");
  });
});
