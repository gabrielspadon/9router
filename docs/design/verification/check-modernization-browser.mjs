#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_ROUTES = [
  "login", "landing", "dashboard-home", "providers", "providers-new", "provider-claude",
  "statistics", "usage", "quota", "endpoint", "combos",
  "basic-chat", "console-log", "media-providers", "memory", "model-context",
  "profile", "proxy-pools", "pxpipe", "skills", "token-saver", "translator",
];

const count = (value) => (Array.isArray(value) ? value.length : 0);

export function summarizeAudit(audit) {
  const issues = [];
  const routes = audit?.routes && typeof audit.routes === "object" ? audit.routes : {};
  for (const [key, route] of Object.entries(routes)) {
    if (route.navError) issues.push(`${key} navigation failed`);
    if (count(route.consoleErrors)) issues.push(`${key} console errors=${count(route.consoleErrors)}`);
    if (count(route.failedRequests)) issues.push(`${key} failed requests=${count(route.failedRequests)}`);
    if (count(route.auditErrors)) issues.push(`${key} audit errors=${count(route.auditErrors)}`);
    if (count(route.contrast)) issues.push(`${key} contrast failures=${count(route.contrast)}`);
    if (count(route.names?.unnamed)) issues.push(`${key} unnamed controls=${count(route.names.unnamed)}`);
    if (count(route.focus?.bad)) issues.push(`${key} focus failures=${count(route.focus.bad)}`);
    if (route.tabOrder?.escaped) issues.push(`${key} keyboard focus escaped=1`);
    if (Number(route.tabOrder?.unnamed) > 0) issues.push(`${key} unnamed tab stops=${route.tabOrder.unnamed}`);
    if (count(route.hueOnly)) issues.push(`${key} hue-only indicators=${count(route.hueOnly)}`);
    if (Number(route.reflow?.overflow) > 0) issues.push(`${key} reflow overflow=${route.reflow.overflow}`);
    // Hit targets were measured into every capture from the start and read by
    // nothing, so a report could show all zeroes while 150 controls sat under
    // the floor. A measurement no gate consults is not evidence.
    if (Number(route.hitTargets?.small) > 0) issues.push(`${key} hit targets below floor=${route.hitTargets.small}`);
  }
  return { views: Object.keys(routes).length, issues };
}

export function provenanceIssues(audit) {
  const provenance = audit?.provenance && typeof audit.provenance === "object"
    ? audit.provenance
    : {};
  const required = [
    ["seedDigest", "missing audit seed digest"],
    ["sourceRevision", "missing audit source revision"],
    ["buildId", "missing audit build ID"],
  ];
  return required
    .filter(([field]) => typeof provenance[field] !== "string" || !provenance[field].trim())
    .map(([, issue]) => issue);
}

function coverageIssues(audit) {
  const routes = new Set(Object.keys(audit.routes || {}).map((key) => key.split("|")[0]));
  const issues = REQUIRED_ROUTES.filter((route) => !routes.has(route)).map((route) => `missing route ${route}`);
  const expectedViews = REQUIRED_ROUTES.length * 7;
  if (Object.keys(audit.routes || {}).length !== expectedViews) {
    issues.push(`expected ${expectedViews} views, found ${Object.keys(audit.routes || {}).length}`);
  }
  return issues;
}

function parseFileArg(args) {
  if (!args.length) return "docs/design/evidence/raw/after.json";
  if (args.length === 2 && args[0] === "--file") return args[1];
  throw new Error("usage: check-modernization-browser.mjs [--file <audit.json>]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let file;
  try {
    file = parseFileArg(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  let audit;
  try {
    audit = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`cannot read browser audit: ${error.message}`);
    process.exit(1);
  }

  const result = summarizeAudit(audit);
  const issues = [...provenanceIssues(audit), ...coverageIssues(audit), ...result.issues];
  console.log(`browser evidence: ${result.views} views, ${issues.length} issues`);
  if (issues.length) {
    issues.slice(0, 40).forEach((issue) => console.error(`  ${issue}`));
    process.exit(1);
  }
  console.log("modernization browser coverage ok");
}
