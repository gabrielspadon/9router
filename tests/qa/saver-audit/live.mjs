#!/usr/bin/env node
// Live token-saver audit: replays a synthetic Claude Code-shaped session
// through the TEST tokenproxy instance (127.0.0.1:20129), once per
// token-saver configuration, and records real Anthropic prompt-cache usage
// per turn. See tests/qa/saver-audit/live.mjs invocation notes in the task
// that produced this file.
//
// KNOWN INFRA QUIRK (worked around here, not fixed): the live "cc" (Claude
// provider) connection cloaks client tools before sending upstream, and the
// deployed build's cloaking pass does not suffix a client tool whose name
// already matches a native Claude Code tool name (Bash, Read, Edit, Write,
// Grep, Glob, ...) before appending its own decoy list of those exact names —
// current worktree source (open-sse/utils/claudeCloaking.js) always suffixes,
// so the running binary is stale relative to this tree. The visible symptom
// is upstream 400 "tools: Tool names must be unique." on every turn, 100% of
// the time, since fixture.mjs's CORE_TOOLS deliberately uses those names.
// Renaming the colliding tool names before send (and any tool_use blocks
// that reference them) avoids it; the renamed tools are functionally
// identical placeholders and no production saver keys on exact tool name.
// A second consequence of decoy injection: the proxy re-anchors its own
// ttl=1h cache_control onto the true last tool (now one of the appended
// decoys), so a client-set cache_control on the fixture's last tool (default
// ttl=5m) becomes an earlier, lower-ttl breakpoint than that anchor, which
// Anthropic rejects as out-of-order. Dropping the client-set tools[].cache_control
// before send (the proxy assigns its own anchor regardless) avoids it too.

import { writeFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { buildSession, turnBodies } from "./fixture.mjs";
import { estimateRequestTokens } from "../../../open-sse/services/memory/contextBudget.js";
import { CC_DEFAULT_TOOLS } from "../../../open-sse/config/appConstants.js";

const BASE = "http://127.0.0.1:20129";
const MODEL = "audit/cc/claude-haiku-4-5";
const OUT_DIR = process.env.OUT_DIR || "/tmp/saver-audit-live";
const ROUNDS = 12;
const TOOL_COUNT = 64;
const MAX_TOKENS = 32;

const BASELINE_OFF = {
  rtkEnabled: false, schemaDistillEnabled: false, thinkingStripEnabled: false,
  queryAwareCompressionEnabled: false, pairDropEnabled: false, embedReorderEnabled: false,
  midPrefixInjectEnabled: false, privacyFilterEnabled: false, headroomEnabled: false,
  cavemanEnabled: false, ponytailEnabled: false, pxpipeEnabled: false,
  memoryToolPruningEnabled: false, memoryMediaPruningEnabled: false, memoryCompactionEnabled: false,
  memoryHandoffEnabled: false, toolDisclosureEnabled: false, toolDisclosureFilterEnabled: false,
  memoryContextWindowOverride: null,
};

function buildMatrix(W) {
  return [
    ["off", {}],
    ["tools", { toolDisclosureEnabled: true, toolDisclosureFilterEnabled: true, toolDisclosureMaxTools: 24 }],
    ["schema", { schemaDistillEnabled: true }],
    ["qac", { queryAwareCompressionEnabled: true }],
    ["rtk", { rtkEnabled: true }],
    ["privacy", { privacyFilterEnabled: true, privacyFilterTerms: ["gabriel@spadon.com.br"] }],
    ["inject", { cavemanEnabled: true, ponytailEnabled: true }],
    ["mem-tight", { memoryToolPruningEnabled: true, memoryMediaPruningEnabled: true, memoryMaxToolTurnsKeepFull: 8, memoryContextWindowOverride: W }],
    ["pairs-tight", { pairDropEnabled: true, memoryContextWindowOverride: W }],
    ["qac-midinject", { queryAwareCompressionEnabled: true, midPrefixInjectEnabled: true }],
    ["all-wide", {
      rtkEnabled: true, schemaDistillEnabled: true, queryAwareCompressionEnabled: true, pairDropEnabled: true,
      midPrefixInjectEnabled: true, cavemanEnabled: true, ponytailEnabled: true, memoryToolPruningEnabled: true,
      memoryMediaPruningEnabled: true, toolDisclosureEnabled: true, toolDisclosureFilterEnabled: true, toolDisclosureMaxTools: 24,
    }],
    ["all-tight", {
      rtkEnabled: true, schemaDistillEnabled: true, queryAwareCompressionEnabled: true, pairDropEnabled: true,
      midPrefixInjectEnabled: true, cavemanEnabled: true, ponytailEnabled: true, memoryToolPruningEnabled: true,
      memoryMediaPruningEnabled: true, toolDisclosureEnabled: true, toolDisclosureFilterEnabled: true, toolDisclosureMaxTools: 24,
      memoryMaxToolTurnsKeepFull: 8, memoryContextWindowOverride: W,
    }],
  ];
}

// --- HTTP + cookie jar --------------------------------------------------

let cookie = null;

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "123456" }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("login returned no set-cookie");
  cookie = setCookie.split(";")[0];
}

async function patchSettings(overrides) {
  const res = await fetch(`${BASE}/api/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json", Cookie: cookie },
    body: JSON.stringify(overrides),
  });
  if (!res.ok) throw new Error(`PATCH /api/settings failed: ${res.status} ${await res.text()}`);
}

async function apiKey() {
  return (await readFile("/tmp/tp-audit-key", "utf8")).trim();
}

// --- tool-name collision workaround (see header comment) ----------------

function sanitizeBody(body) {
  const rename = (n) => (CC_DEFAULT_TOOLS.has(n) ? `${n}_sess` : n);
  for (const t of body.tools) {
    t.name = rename(t.name);
    delete t.cache_control;
  }
  for (const msg of body.messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const b of msg.content) {
      if (b.type === "tool_use") b.name = rename(b.name);
    }
  }
  return body;
}

// --- turn execution -------------------------------------------------------

async function sendTurn(body, key) {
  const res = await fetch(`${BASE}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const tpHeaders = {};
  for (const [k, v] of res.headers.entries()) if (k.startsWith("x-tp")) tpHeaders[k] = v;
  const text = await res.text();
  let usage = null;
  let errorText = null;
  if (res.status === 200) {
    try {
      usage = JSON.parse(text).usage || null;
    } catch {
      errorText = `unparseable 200 body: ${text.slice(0, 300)}`;
    }
  } else {
    errorText = text.slice(0, 300);
  }
  return { status: res.status, usage, errorText, tpHeaders };
}

function hitFraction(u) {
  if (!u) return null;
  const denom = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  if (denom === 0) return null;
  return (u.cache_read_input_tokens || 0) / denom;
}

async function runConfig(name, overrides, turns, key, resultsStream) {
  await patchSettings({ ...BASELINE_OFF, ...overrides });
  await new Promise((r) => setTimeout(r, 500));

  const rows = [];
  for (const { turn, body } of turns) {
    const entryBytes = JSON.stringify(body).length;
    const sanitized = sanitizeBody(body);
    const { status, usage, errorText, tpHeaders } = await sendTurn(sanitized, key);
    const row = { config: name, turn, entryBytes, status, usage, errorText, tpHeaders };
    rows.push(row);
    resultsStream.write(JSON.stringify(row) + "\n");
    if (status !== 200) {
      console.log(`  turn ${turn}: ${status} ${errorText ?? ""}`);
    }
    // The production gateway admits 60 requests per key per minute; a run
    // that fires turns back to back trips it on the second config.
    await new Promise((r) => setTimeout(r, 1500));
  }

  const ok = rows.filter((r) => r.status === 200);
  const totals = ok.reduce(
    (acc, r) => {
      acc.input += r.usage?.input_tokens || 0;
      acc.cacheCreate += r.usage?.cache_creation_input_tokens || 0;
      acc.cacheRead += r.usage?.cache_read_input_tokens || 0;
      return acc;
    },
    { input: 0, cacheCreate: 0, cacheRead: 0 },
  );
  const hitFractions = ok.slice(1).map((r) => hitFraction(r.usage)).filter((h) => h !== null);
  const hitMean = hitFractions.length ? hitFractions.reduce((a, b) => a + b, 0) / hitFractions.length : null;
  const rewrites = hitFractions.filter((h) => h < 0.5).length;

  return {
    config: name,
    turnsTotal: rows.length,
    turnsOk: ok.length,
    hitMean,
    rewrites,
    inputTokens: totals.input,
    cacheCreateTokens: totals.cacheCreate,
    cacheReadTokens: totals.cacheRead,
  };
}

// --- main ------------------------------------------------------------------

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const { createWriteStream } = await import("node:fs");
  const resultsStream = createWriteStream(`${OUT_DIR}/results.jsonl`);

  await login();
  const key = await apiKey();

  const session = buildSession({ seed: 7, rounds: ROUNDS, toolCount: TOOL_COUNT, thinking: false });
  const turns = turnBodies(session, { model: MODEL, maxTokens: MAX_TOKENS });
  console.log(`session built: ${turns.length} turns`);

  const lastBody = turns[turns.length - 1].body;
  const est = estimateRequestTokens(lastBody);
  const W = Math.round(Math.max(est * 0.55 + 8000, est * 0.55 / 0.95));
  console.log(`W (context window override) = ${W} (est=${est})`);

  const matrix = buildMatrix(W).filter(([n]) => !process.env.CONFIGS || process.env.CONFIGS.split(",").includes(n));
  const summaries = [];

  for (const [name, overrides] of matrix) {
    console.log(`=== config: ${name} ===`);
    // Re-derive turns fresh per config: sanitizeBody mutates in place and
    // turnBodies structuredClone's from session per call, so a fresh set
    // per config avoids cross-config mutation.
    const freshTurns = turnBodies(session, { model: MODEL, maxTokens: MAX_TOKENS });
    await new Promise((r) => setTimeout(r, 15000));
    const summary = await runConfig(name, overrides, freshTurns, key, resultsStream);
    summaries.push(summary);
    console.log(
      `  turnsOk=${summary.turnsOk}/${summary.turnsTotal} hitMean=${summary.hitMean?.toFixed(3) ?? "n/a"} ` +
      `rewrites=${summary.rewrites} cacheWrite=${summary.cacheCreateTokens} input=${summary.inputTokens}`,
    );
  }

  // Calibration probe: BASELINE_OFF, last turn only.
  await patchSettings(BASELINE_OFF);
  await new Promise((r) => setTimeout(r, 500));
  const calibTurns = turnBodies(session, { model: MODEL, maxTokens: MAX_TOKENS });
  const calibBody = calibTurns[calibTurns.length - 1].body;
  const entryBytes = JSON.stringify(calibBody).length;
  const sanitizedCalib = sanitizeBody(calibBody);
  const calibRes = await sendTurn(sanitizedCalib, key);
  const calibTokens = calibRes.usage
    ? (calibRes.usage.input_tokens || 0) + (calibRes.usage.cache_creation_input_tokens || 0) + (calibRes.usage.cache_read_input_tokens || 0)
    : null;
  const calibEst = estimateRequestTokens(calibBody);
  const calibration = calibTokens
    ? {
        entryBytes,
        tokens: calibTokens,
        bytesPerToken: entryBytes / calibTokens,
        charsPerToken: JSON.stringify(calibBody).length / calibTokens,
        estimated: calibEst,
        actualOverEstimated: calibTokens / calibEst,
      }
    : { entryBytes, error: calibRes.errorText, status: calibRes.status };
  console.log("=== calibration ===");
  console.log(calibration);

  // Restore baseline.
  await patchSettings(BASELINE_OFF);

  resultsStream.end();
  const summaryOut = { W, estLastTurn: est, matrix: summaries, calibration };
  writeFileSync(`${OUT_DIR}/summary.json`, JSON.stringify(summaryOut, null, 2));

  console.log("\n=== table ===");
  console.log("config           turnsOk  hitMean  rewrites  cacheWriteTokens  inputTokens");
  for (const s of summaries) {
    console.log(
      `${s.config.padEnd(16)} ${String(s.turnsOk).padStart(7)}  ${(s.hitMean?.toFixed(3) ?? "n/a").padStart(7)}  ` +
      `${String(s.rewrites).padStart(8)}  ${String(s.cacheCreateTokens).padStart(16)}  ${String(s.inputTokens).padStart(11)}`,
    );
  }
  console.log(`\nresults: ${OUT_DIR}/results.jsonl`);
  console.log(`summary: ${OUT_DIR}/summary.json`);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exitCode = 1;
});
