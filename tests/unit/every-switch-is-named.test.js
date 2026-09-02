import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// A repo invariant rather than a test of one component: a switch with no
// accessible name is announced as "switch" and nothing else, so a screen-reader
// user hears the state of something unidentified. Eleven of these survived three
// separate naming passes this session, each pass finding only the ones its own
// route sample happened to show.
//
// This asserts the policy, not any implementation string. `Toggle.js` may name
// itself however it likes; what it may not do is be rendered without one of
// `ariaLabel`, a `label`, or a `title` to name it from.
//
// The scan reads whole JSX elements rather than stopping at the first ">", which
// an arrow function inside a prop supplies long before the element ends. Getting
// that wrong reports named switches as unnamed, which is how this check was
// first written and why it says so here.

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function jsFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(rel));
    else if (entry.name.endsWith(".js")) out.push(rel);
  }
  return out;
}

function unnamedSwitchesIn(relPath) {
  const lines = readFileSync(join(repoRoot, relPath), "utf8").split("\n");
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/<Toggle\b/.test(lines[i])) continue;
    let block = lines[i];
    let braces = countBraces(lines[i]);
    let j = i;
    while (j < lines.length - 1 && !(braces <= 0 && /(\/>|^\s*>)\s*$/.test(lines[j]))) {
      j += 1;
      block += `\n${lines[j]}`;
      braces += countBraces(lines[j]);
      if (j - i > 25) break;
    }
    if (!/\bariaLabel\b|\blabel=|\btitle=/.test(block)) found.push(`${relPath}:${i + 1}`);
  }
  return found;
}

const countBraces = (line) =>
  (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

describe("every rendered switch has an accessible name", () => {
  const files = [...jsFilesUnder("src/app"), ...jsFilesUnder("src/shared")].filter(
    (f) => !f.endsWith(join("shared", "components", "Toggle.js")),
  );

  it("finds switches to check, so a passing run is not an empty one", () => {
    const total = files.filter((f) => /<Toggle\b/.test(readFileSync(join(repoRoot, f), "utf8")));
    expect(total.length).toBeGreaterThan(10);
  });

  it("leaves none of them unnamed", () => {
    const unnamed = files.flatMap(unnamedSwitchesIn);
    expect(unnamed).toEqual([]);
  });

  it("does not mistake an arrow function's > for the end of the element", () => {
    // The shape that broke the first version of this scan.
    const sample = [
      "<Toggle",
      "  checked={on}",
      "  onChange={(v) => patch({ enabled: v })}",
      '  ariaLabel="Enable the thing"',
      "/>",
    ].join("\n");
    expect(/\bariaLabel\b/.test(sample)).toBe(true);
  });
});
