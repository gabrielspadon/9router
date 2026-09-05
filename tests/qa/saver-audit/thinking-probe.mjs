#!/usr/bin/env node
// Does the provider bill a historical thinking block? The thinking-strip saver
// removes reasoning blocks from earlier assistant turns; if the provider
// already ignores them, the stage saves nothing on that provider and only
// costs a prefix change. Measured, not assumed: one real thinking turn is
// obtained, then the same follow-up request is sent with and without that
// block in history and the billed prompt sizes are compared.
//
// Runs against the audit test instance (port 20129) with every saver off.
// TEST_BASE, TEST_KEY_FILE and MODEL override the defaults.

import { readFileSync } from "node:fs";

const BASE = process.env.TEST_BASE || "http://127.0.0.1:20129";
const KEY = readFileSync(process.env.TEST_KEY_FILE || "/tmp/tp-audit-key", "utf8").trim();
const MODEL = process.env.MODEL || "audit/cc/claude-haiku-4-5";

async function send(body) {
  const res = await fetch(`${BASE}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (res.status !== 200) throw new Error(`${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

const prompt = (n) => Array.from({ length: n }, (_, i) =>
  `Item ${i}: the ingest watermark for vessel batch ${i} resumed from chunk ${i * 7} after a compression policy change.`).join("\n");

const question = `${prompt(120)}\n\nIn one sentence, which batch resumed from the highest chunk?`;

const first = await send({
  model: MODEL, max_tokens: 2500, thinking: { type: "enabled", budget_tokens: 2000 },
  messages: [{ role: "user", content: question }],
});
const thinking = first.content.filter((b) => b.type === "thinking" || b.type === "redacted_thinking");
const text = first.content.filter((b) => b.type === "text");
console.log("first turn usage", first.usage, "thinking blocks", thinking.length, "thinking chars", JSON.stringify(thinking).length);
if (thinking.length === 0) { console.log("no thinking block returned; probe inconclusive"); process.exit(0); }

const followUp = { role: "user", content: "Now name the lowest one, one sentence." };
const withThinking = { model: MODEL, max_tokens: 300, thinking: { type: "enabled", budget_tokens: 1024 },
  messages: [{ role: "user", content: question }, { role: "assistant", content: [...thinking, ...text] }, followUp] };
const without = { ...withThinking, messages: [withThinking.messages[0], { role: "assistant", content: text }, followUp] };

await new Promise((r) => setTimeout(r, 1500));
const a = await send(withThinking);
await new Promise((r) => setTimeout(r, 1500));
const b = await send(without);
const size = (u) => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
console.log("with historical thinking   :", a.usage, "prompt", size(a.usage));
console.log("without historical thinking:", b.usage, "prompt", size(b.usage));
console.log("billed difference (with - without):", size(a.usage) - size(b.usage), "tokens; thinking block chars:", JSON.stringify(thinking).length);
