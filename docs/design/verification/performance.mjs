#!/usr/bin/env node
// Repeatable production-browser navigation measurements. It captures timing,
// element identity, and URLs without userinfo, queries, fragments, or content.
//
//   node docs/design/verification/performance.mjs \
//     --base http://127.0.0.1:20141 --samples 3 \
//     --out docs/design/evidence/performance-report.json
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { buildEvidencePrivacyContext, redactEvidenceValue } from "./redactEvidence.mjs";

const require = createRequire(import.meta.url);

export function percentile(values, p) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const index = (ordered.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return ordered[lower];
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower);
}

const rounded = (value) => value == null ? null : Math.round(value * 100) / 100;

const roundedTiming = (value) => value == null || !Number.isFinite(Number(value))
  ? null
  : rounded(Number(value));

function safePerformanceUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function timingDifference(end, start) {
  const endNumber = Number(end);
  const startNumber = Number(start);
  if (!Number.isFinite(endNumber) || !Number.isFinite(startNumber) || endNumber < startNumber) return null;
  return rounded(endNumber - startNumber);
}

export function normalizePerformanceSnapshot(snapshot) {
  const observerSupport = {
    lcp: snapshot.observerSupport?.lcp ?? null,
    longTask: snapshot.observerSupport?.longTask ?? null,
  };
  const lcp = snapshot.lcp
    ? {
        startTimeMs: roundedTiming(snapshot.lcp.startTime),
        renderTimeMs: roundedTiming(snapshot.lcp.renderTime),
        loadTimeMs: roundedTiming(snapshot.lcp.loadTime),
        size: roundedTiming(snapshot.lcp.size),
        url: safePerformanceUrl(snapshot.lcp.url),
        element: snapshot.lcp.element
          ? {
              tagName: snapshot.lcp.element.tagName?.toLowerCase() || null,
              id: snapshot.lcp.element.id || null,
              classNames: [...(snapshot.lcp.element.classNames || [])].sort(),
            }
          : null,
      }
    : null;
  const longTasks = (snapshot.longTasks || []).map((entry) => ({
    name: entry.name || null,
    startTimeMs: roundedTiming(entry.startTime),
    durationMs: roundedTiming(entry.duration),
    attribution: (entry.attribution || []).map((item) => ({
      name: item.name || null,
      containerType: item.containerType || null,
      containerName: item.containerName || null,
      containerId: item.containerId || null,
      containerSrc: safePerformanceUrl(item.containerSrc),
    })),
  })).sort((a, b) =>
    (a.startTimeMs ?? 0) - (b.startTimeMs ?? 0)
    || (a.durationMs ?? 0) - (b.durationMs ?? 0)
    || String(a.name).localeCompare(String(b.name)),
  );
  const resourceTimings = (snapshot.resources || []).map((entry) => ({
    url: safePerformanceUrl(entry.name),
    initiatorType: entry.initiatorType || "other",
    startTimeMs: roundedTiming(entry.startTime),
    durationMs: roundedTiming(entry.duration),
    timingMs: {
      redirect: timingDifference(entry.redirectEnd, entry.redirectStart),
      dns: timingDifference(entry.domainLookupEnd, entry.domainLookupStart),
      connect: timingDifference(entry.connectEnd, entry.connectStart),
      tls: Number(entry.secureConnectionStart) > 0
        ? timingDifference(entry.connectEnd, entry.secureConnectionStart)
        : 0,
      request: timingDifference(entry.responseStart, entry.requestStart),
      response: timingDifference(entry.responseEnd, entry.responseStart),
    },
    transferBytes: roundedTiming(entry.transferSize),
    encodedBodyBytes: roundedTiming(entry.encodedBodySize),
    decodedBodyBytes: roundedTiming(entry.decodedBodySize),
  })).sort((a, b) =>
    (a.startTimeMs ?? 0) - (b.startTimeMs ?? 0)
    || String(a.url).localeCompare(String(b.url))
    || a.initiatorType.localeCompare(b.initiatorType),
  );
  return {
    navMs: roundedTiming(snapshot.navigation?.duration),
    lcpMs: lcp?.startTimeMs ?? null,
    longTaskMs: observerSupport.longTask === false
      ? null
      : rounded(Math.max(0, ...longTasks.map((entry) => Number(entry.durationMs)).filter(Number.isFinite))),
    transferBytes: rounded(resourceTimings.reduce((total, resource) => total + (Number(resource.transferBytes) || 0), 0)),
    observerSupport,
    lcp,
    longTasks,
    resourceTimings,
  };
}

export function buildMeasurementRow(route, mode, metrics, problems) {
  return { route, mode, ...metrics, problems };
}

export function installPerformanceObservers(target = window, Observer = PerformanceObserver) {
  target.__tokenProxyPerf = {
    observerSupport: { lcp: false, longTask: false },
    lcp: null,
    longTasks: [],
  };
  try {
    new Observer((list) => {
      for (const entry of list.getEntries()) {
        const element = entry.element;
        target.__tokenProxyPerf.lcp = {
          startTime: entry.startTime,
          renderTime: entry.renderTime,
          loadTime: entry.loadTime,
          size: entry.size,
          url: entry.url || null,
          element: element
            ? {
                tagName: element.tagName?.toLowerCase() || null,
                id: element.id || null,
                classNames: [...(element.classList || [])].sort(),
              }
            : null,
        };
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    target.__tokenProxyPerf.observerSupport.lcp = true;
  } catch { /* Unsupported LCP observation leaves null evidence. */ }
  try {
    new Observer((list) => {
      for (const entry of list.getEntries()) {
        target.__tokenProxyPerf.longTasks.push({
          name: entry.name || null,
          startTime: entry.startTime,
          duration: entry.duration,
          attribution: [...(entry.attribution || [])].map((item) => ({
            name: item.name || null,
            containerType: item.containerType || null,
            containerName: item.containerName || null,
            containerId: item.containerId || null,
            containerSrc: item.containerSrc || null,
          })),
        });
      }
    }).observe({ type: "longtask", buffered: true });
    target.__tokenProxyPerf.observerSupport.longTask = true;
  } catch { /* Unsupported long-task observation leaves empty evidence. */ }
}

export function readPerformanceSnapshot(target = window, performanceApi = performance) {
  const navigation = performanceApi.getEntriesByType("navigation")[0];
  const resources = performanceApi.getEntriesByType("resource");
  return {
    navigation: navigation ? { duration: navigation.duration } : null,
    observerSupport: target.__tokenProxyPerf?.observerSupport ?? { lcp: false, longTask: false },
    lcp: target.__tokenProxyPerf?.lcp ?? null,
    longTasks: target.__tokenProxyPerf?.longTasks ?? [],
    resources: resources.map((resource) => ({
      name: resource.name,
      initiatorType: resource.initiatorType,
      startTime: resource.startTime,
      duration: resource.duration,
      redirectStart: resource.redirectStart,
      redirectEnd: resource.redirectEnd,
      domainLookupStart: resource.domainLookupStart,
      domainLookupEnd: resource.domainLookupEnd,
      connectStart: resource.connectStart,
      secureConnectionStart: resource.secureConnectionStart,
      connectEnd: resource.connectEnd,
      requestStart: resource.requestStart,
      responseStart: resource.responseStart,
      responseEnd: resource.responseEnd,
      transferSize: resource.transferSize,
      encodedBodySize: resource.encodedBodySize,
      decodedBodySize: resource.decodedBodySize,
    })),
  };
}

export function summarizeMeasurements(measurements) {
  const groups = new Map();
  for (const measurement of measurements) {
    const key = `${measurement.route}\u0000${measurement.mode}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(measurement);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const [route, mode] = key.split("\u0000");
    const values = (field) => rows
      .map((row) => row[field])
      .filter((value) => value != null && value !== "")
      .map(Number)
      .filter(Number.isFinite);
    const median = (field) => rounded(percentile(values(field), 0.5));
    const longTaskValues = values("longTaskMs");
    return {
      route,
      mode,
      samples: rows.length,
      navMs: { median: median("navMs"), p75: rounded(percentile(values("navMs"), 0.75)) },
      lcpMs: { median: median("lcpMs"), p75: rounded(percentile(values("lcpMs"), 0.75)) },
      longTaskMs: { max: longTaskValues.length ? rounded(Math.max(...longTaskValues)) : null },
      transferBytes: { median: median("transferBytes") },
    };
  }).sort((a, b) => a.route.localeCompare(b.route) || a.mode.localeCompare(b.mode));
}

export function renderPerformanceReport(report) {
  const rows = (report.summary || []).map((row) =>
    `| ${row.route} | ${row.mode} | ${row.navMs?.p75 ?? "n/a"} | ${row.lcpMs?.p75 ?? "n/a"} | ${row.transferBytes?.median ?? "n/a"} | ${row.longTaskMs?.max ?? "n/a"} |`,
  ).join("\n");
  const gaps = (report.summary || []).flatMap((row) => {
    const prefix = `${row.route} ${row.mode}`;
    const issues = [];
    if (!Number.isFinite(row.lcpMs?.p75)) issues.push(`${prefix} LCP p75 was not recorded`);
    else if (row.lcpMs.p75 > 1800) issues.push(`${prefix} LCP p75 exceeds the 1,800 ms target`);
    if (!Number.isFinite(row.longTaskMs?.max)) issues.push(`${prefix} long-task observation was not recorded`);
    else if (row.longTaskMs.max > 50) issues.push(`${prefix} long task exceeds the 50 ms target`);
    return issues;
  });
  const conditions = Object.entries(report.conditions || {})
    .map(([name, value]) => `- ${name}: ${value}`)
    .join("\n");
  const build = report.provenance?.buildId || "not recorded";
  const source = report.provenance?.sourceDigest || "not recorded";

  return `# Performance report

Measured ${report.generatedAt} against ${report.base}.

## Build identity

- Build ID: ${build}
- Source digest: ${source}

## Conditions

${conditions || "- not recorded"}

## Results

| Route | Mode | p75 navigation ms | p75 LCP ms | Median transfer bytes | Long task max ms |
|---|---|---:|---:|---:|---:|
${rows || "| no measurements | | | | | |"}

## Budget disposition

${gaps.length ? gaps.map((gap) => `- ${gap}.`).join("\n") : "- No measured LCP or long-task budget gap."}

No budget is reported as a pass. These are isolated production-build lab measurements, not field RUM.
`;
}

function parseArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error("arguments must be --key value pairs");
    values.set(key, value);
  }
  const base = values.get("--base") || "http://127.0.0.1:20135";
  const samples = Number(values.get("--samples") || "3");
  const out = values.get("--out") || "docs/design/evidence/performance-report.json";
  const provenance = values.get("--provenance") || "";
  if (!/^https?:\/\//.test(base)) throw new Error("--base must be an http(s) URL");
  if (!Number.isInteger(samples) || samples < 3 || samples > 10) throw new Error("--samples must be an integer from 3 to 10");
  if ([...values.keys()].some((key) => !["--base", "--samples", "--out", "--provenance"].includes(key))) throw new Error("usage: performance.mjs [--base URL] [--samples 3-10] [--out FILE] [--provenance FILE]");
  return { base: base.replace(/\/$/, ""), samples, out: resolve(out), provenance: provenance ? resolve(provenance) : "" };
}

const ROUTES = [
  ["dashboard", "/dashboard"],
  ["providers", "/dashboard/providers"],
  ["token-saver", "/dashboard/token-saver"],
];

// A console error or failed request on /dashboard/providers can echo a
// connection label or a provider-node host, which no pattern rule catches. The
// alias context is what masks those, so it is fetched here and its absence is
// fatal rather than silently producing evidence that only looks redacted.
async function login(browser, base, password) {
  const context = await browser.newContext({ baseURL: base });
  const response = await context.request.post("/api/auth/login", {
    data: { password }, headers: { "Content-Type": "application/json" },
  });
  if (!response.ok()) throw new Error(`login failed: ${response.status()}`);
  const [connections, nodes] = await Promise.all([
    context.request.get("/api/providers"),
    context.request.get("/api/provider-nodes"),
  ]);
  if (!connections.ok() || !nodes.ok()) throw new Error("privacy context unavailable; refusing to retain evidence");
  const privacyContext = buildEvidencePrivacyContext({
    connections: (await connections.json()).connections || [],
    nodes: (await nodes.json()).nodes || [],
  });
  const storageState = await context.storageState();
  await context.close();
  return { storageState, privacyContext };
}

async function configurePage(page) {
  await page.addInitScript(installPerformanceObservers);
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: 1_500 * 1024 / 8,
    uploadThroughput: 750 * 1024 / 8,
  });
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

async function capture(browser, storageState, base, route, path, mode) {
  const context = await browser.newContext({
    baseURL: base,
    storageState,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await configurePage(page);
  const problems = [];
  page.on("pageerror", (error) => problems.push(`pageerror ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") problems.push(`console ${message.text()}`); });
  page.on("requestfailed", (request) => {
    if (!request.failure()?.errorText?.includes("ERR_ABORTED")) problems.push(`network ${request.failure()?.errorText || "failed"}`);
  });

  if (mode === "warm") {
    await page.goto(path, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(500);
  }
  const response = await page.goto(path, { waitUntil: "load", timeout: 60_000 });
  await page.waitForTimeout(2_000);
  const snapshot = await page.evaluate(readPerformanceSnapshot);
  const metrics = normalizePerformanceSnapshot(snapshot);
  if (!response?.ok()) problems.push(`document ${response?.status() || "missing"}`);
  await context.close();
  return buildMeasurementRow(route, mode, metrics, problems);
}

export async function measure(options) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    const { storageState, privacyContext } = await login(browser, options.base, options.password || process.env.SMOKE_PASSWORD || "123456");
    const measurements = [];
    for (const mode of ["cold", "warm"]) {
      for (const [route, path] of ROUTES) {
        for (let sample = 0; sample < options.samples; sample += 1) {
          const row = await capture(browser, storageState, options.base, route, path, mode);
          measurements.push({ ...row, sample: sample + 1 });
          console.log(`${route}|${mode}|${sample + 1} nav=${row.navMs} lcp=${row.lcpMs} long=${row.longTaskMs} bytes=${row.transferBytes} problems=${row.problems.length}`);
        }
      }
    }
    return { measurements, privacyContext };
  } finally {
    await browser.close();
  }
}

// The measured base URL, every resource URL and every captured page/console/
// network message are local endpoints and upstream text, and this report is
// committed evidence. Redact the whole record once, here, so the JSON and the
// rendered markdown can never disagree about what was masked.
export function buildPerformanceReport(measurements, options) {
  const problems = measurements.flatMap((row) => row.problems.map((problem) => ({ route: row.route, mode: row.mode, sample: row.sample, problem })));
  // Only the captured half is redacted. The conditions block is authored text,
  // and an alias for a short provider-node name would otherwise rewrite words
  // inside our own constants.
  const captured = redactEvidenceValue({ base: options.base, measurements, problems }, options.privacyContext);
  return {
    generatedAt: new Date().toISOString(),
    base: captured.base,
    conditions: {
      browser: "Chromium headless",
      viewport: "390x844 CSS pixels, mobile touch emulation",
      network: "150 ms RTT, 1500 kbps down, 750 kbps up",
      cpu: "4x CDP throttling",
      samplesPerRouteAndMode: options.samples,
      note: "Local isolated production build. Results are reproducible lab measurements, not field RUM.",
    },
    measurements: captured.measurements,
    summary: summarizeMeasurements(captured.measurements),
    problems: captured.problems,
    provenance: options.provenance ? JSON.parse(readFileSync(options.provenance, "utf8")) : null,
  };
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exit(2); }
  const { measurements, privacyContext } = await measure(options);
  const report = buildPerformanceReport(measurements, { ...options, privacyContext });
  const problems = report.problems;
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  const markdownOut = options.out.endsWith(".json")
    ? `${options.out.slice(0, -5)}.md`
    : `${options.out}.md`;
  writeFileSync(markdownOut, renderPerformanceReport(report));
  console.log(`wrote ${options.out}`);
  console.log(`wrote ${markdownOut}`);
  if (problems.length) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
}
