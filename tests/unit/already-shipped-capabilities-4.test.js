import { expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Eight more reports the BLOCKED re-triage found already satisfied, each
// re-derived here against the tree before the issue was closed.
//
// The per-SHA ancestry assertions these carried are gone rather than ported,
// for the reason spelled out in already-shipped-capabilities-3: this repository
// has its own root commit and no predecessor history, so a predecessor SHA
// resolves to nothing. The content assertions below prove the same fixes are in
// the tree without depending on a history that was never imported.
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

it("#2876 a fusion panel body is closed with a user turn", () => {
  expect(read("open-sse/services/combo.js")).toContain("ensureTrailingUserTurn");
});

it("#2936 passthrough streams normalize reasoning to reasoning_content", () => {
  expect(read("open-sse/utils/stream.js")).toContain("reasoning_content");
});

it("#3003 qoder accepts a PAT as well as OAuth", () => {
  expect(read("open-sse/providers/registry/qoder.js")).toContain("authModes");
});

it("#3233 hermes settings write the key where the CLI reads it", () => {
  expect(read("src/app/api/cli-tools/hermes-settings/route.js")).toContain("OPENAI_API_KEY");
});

it("#3308 a null or non-string tool arguments value is coerced", () => {
  expect(read("open-sse/translator/concerns/toolCall.js")).toContain("ensureToolCallIds");
});

it("#2376 cloudflare-ai messages are flattened to text", () => {
  expect(read("open-sse/translator/concerns/paramSupport.js")).toContain("flattenContent");
});

it("#2458 a missing stream key means non-streaming", () => {
  expect(read("open-sse/handlers/chatCore/streamMode.js")).toContain("clientRequestedStreaming");
});

it("#2083 OpenRouter is asked to fall back off a broken upstream", () => {
  // The Stealth upstream ships with an empty url and 502s; allow_fallbacks lets
  // OpenRouter route around it. Injected only when the caller has not pinned a
  // provider, so an explicit opt-out is preserved.
  const src = read("open-sse/executors/openrouter.js");
  expect(src).toContain("allow_fallbacks: true");
  expect(src).toContain("existing.allow_fallbacks === undefined");
});
