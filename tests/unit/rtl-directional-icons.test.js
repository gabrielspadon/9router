import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const CSS = readFileSync(join(SRC, "app/globals.css"), "utf8");

// The four ligatures whose meaning is a direction. A glyph that points somewhere
// has to point the other way in a right-to-left locale, and no Tailwind utility
// can express that: the direction lives in the ligature text, not the classes.
const DIRECTIONAL = ["arrow_forward", "arrow_back", "chevron_right", "chevron_left"];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

const spans = [];
for (const file of walk(SRC)) {
  const source = readFileSync(file, "utf8");
  const re = /<span\b[^>]*?material-symbols-outlined[^>]*?>\s*([a-z_]+)\s*<\/span>/gs;
  for (const m of source.matchAll(re)) {
    if (DIRECTIONAL.includes(m[1])) {
      spans.push({ file: file.slice(SRC.length + 1), glyph: m[1], tag: m[0] });
    }
  }
}

describe("directional icons mirror in right-to-left locales", () => {
  it("finds the directional glyphs to check", () => {
    expect(spans.length).toBeGreaterThan(10);
  });

  it("marks every one of them with dir-icon", () => {
    const bare = spans.filter((s) => !s.tag.includes("dir-icon"));
    expect(bare.map((s) => `${s.file}: ${s.glyph}`)).toEqual([]);
  });

  it("defines the rule that mirrors them", () => {
    expect(CSS).toContain('[dir="rtl"] .dir-icon');
  });

  it("gives the right-to-left drawer its own entry keyframe", () => {
    // `.slide-in-right` translates a percentage, which cannot read the writing
    // direction, so under RTL the panel would enter from off the wrong edge.
    expect(CSS).toContain("@keyframes slideInFromLeft");
    expect(CSS).toContain('[dir="rtl"] .slide-in-right');
  });

  it("keeps no unguarded physical box property in the global stylesheet", () => {
    // `left:`/`right:` inside a centering or decorative rule is fine; a
    // directional padding or margin on flowing text is not.
    expect(CSS).not.toMatch(/^\s*(padding|margin)-(left|right):/m);
  });
});
