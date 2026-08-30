#!/usr/bin/env node
// Converts a raw PNG capture from audit2.mjs into the committed webp corpus.
// The PNGs are a build artefact of one audit run; the webp set is the visual
// regression record the repository carries, at roughly a twentieth of the size.
//
//   node docs/design/verification/publish-shots.mjs after [shotsDir]
import { mkdirSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sharp = require("sharp");

const mode = process.argv[2];
if (!["before", "after"].includes(mode)) {
  console.error("usage: publish-shots.mjs <before|after> [shotsDir]");
  process.exit(2);
}
const SRC = `${process.argv[3] || process.env.SHOTS_DIR || "/tmp/9router-design-shots"}/${mode}`;
const DST = `docs/design/evidence/routes/${mode}`;
if (!existsSync(SRC)) { console.error(`no capture at ${SRC}`); process.exit(1); }
mkdirSync(DST, { recursive: true });

const pngs = readdirSync(SRC).filter((f) => f.endsWith(".png"));
let done = 0;
for (const f of pngs) {
  await sharp(`${SRC}/${f}`).webp({ quality: 80 }).toFile(`${DST}/${f.replace(/\.png$/, ".webp")}`);
  done++;
}
console.log(`${mode}: ${done} screenshots published to ${DST}`);
