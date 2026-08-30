#!/usr/bin/env node
// Renders each structural hypothesis to PNG in both themes, one file per
// artboard so the three can be compared side by side.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const DIR = "docs/design/artboards";
mkdirSync(`${DIR}/render`, { recursive: true });
const BOARDS = [
  ["a1-signal-room", "Signal Room"],
  ["a2-route-atlas", "Route Atlas"],
  ["a3-switchboard", "Switchboard"],
];
const browser = await chromium.launch();
for (const [file] of BOARDS) {
  for (const theme of ["dark", "light"]) {
    const ctx = await browser.newContext({ viewport: { width: 1340, height: 1000 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto(`file://${process.cwd()}/${DIR}/${file}.html`);
    if (theme === "light") await page.evaluate(() => document.documentElement.classList.remove("dark"));
    await page.waitForTimeout(350);
    const boards = await page.locator(".artboard").all();
    for (let i = 0; i < boards.length; i++) {
      const tag = ["stateA", "stateB", "stateC"][i] || `state${i}`;
      await boards[i].screenshot({ path: `${DIR}/render/${file}--${theme}--${tag}.png` });
    }
    console.log(`${file} ${theme}: ${boards.length} states`);
    await ctx.close();
  }
}
await browser.close();
