#!/usr/bin/env node
// The README is the front door a developer judges the project by in under a
// minute. This checks the things that make it credible rather than its prose.
import { existsSync, readFileSync, statSync } from "node:fs";
const R = "README.md";
const t = readFileSync(R, "utf8");
const problems = [];

// One hero image, and it has to exist on disk.
const imgs = [...t.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
const local = imgs.filter((s) => !/^https?:/.test(s));
if (local.length !== 1) problems.push(`expected exactly one local hero image, found ${local.length}`);
for (const s of local) {
  const f = s.replace(/^\.\//, "");
  if (!existsSync(f)) problems.push(`hero image missing on disk: ${f}`);
  else if (statSync(f).size < 20000) problems.push(`hero image suspiciously small: ${f}`);
}

// Badges have to say something. A badge that is not version, licence or a
// registry link is decoration.
const badges = imgs.filter((s) => /shields\.io/.test(s));
for (const b of badges)
  if (!/(npm\/v|docker\/v|npm\/l|license)/.test(b)) problems.push(`uninformative badge: ${b}`);

// The disclosures and the verified path a new user follows.
if (!/## Fork status/.test(t)) problems.push("no fork status disclosure");
if (!/independently maintained fork/i.test(t)) problems.push("fork status does not state independence");
if (!/npm install -g 9router/.test(t)) problems.push("no install command");
if (!/curl http:\/\/localhost:20128\/v1\/chat\/completions/.test(t)) problems.push("no first request");
if (!/20128/.test(t)) problems.push("default port not stated");
if (!/docs\/README\.md/.test(t)) problems.push("no link to the documentation index");
if (!/SECURITY\.md/.test(t)) problems.push("no link to the security policy");

// No hype and no decorative emoji. Numbers that drift are the other failure:
// a count of providers or models in prose is wrong within a release.
const emoji = t.match(/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}]/gu) || [];
if (emoji.length) problems.push(`${emoji.length} decorative emoji: ${[...new Set(emoji)].join(" ")}`);
const hype = t.match(/\b(blazing|blazingly|revolutionary|game.chang\w+|effortless\w*|magic\w*|seamless\w*|cutting.edge|world.class)\b/gi) || [];
if (hype.length) problems.push(`hype words: ${[...new Set(hype)].join(", ")}`);
const drifting = [...t.matchAll(/\b(\d{2,})\+?\s+(providers|models|upstreams|integrations)\b/gi)].map((m) => m[0]);
if (drifting.length) problems.push(`counts that drift: ${drifting.join(", ")}`);

console.log(`README: ${local.length} hero image, ${badges.length} badges, ${emoji.length} emoji, ${hype.length} hype words`);
if (problems.length) { problems.forEach((p) => console.log("  " + p)); process.exit(1); }
console.log("FRONTDOOR OK");
