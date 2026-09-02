import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "../..");

function jsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) jsFiles(p, out);
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}
const sources = jsFiles(resolve(root, "src")).map((p) => [p, readFileSync(p, "utf8")]);
const css = readFileSync(resolve(root, "src/app/globals.css"), "utf8");

// design-system.md section 7: icons are ligature based, so the glyph text has
// to be stripped before an accessible name is computed. A Material Symbols span
// with no `aria-hidden` puts the ligature ("close", "dns") into the name of
// whatever contains it, in English, in every locale.
describe("iconography", () => {
  it("hides every icon glyph from the accessibility tree", () => {
    const offenders = [];
    for (const [path, src] of sources) {
      for (const m of src.matchAll(/<span\b[^>]*material-symbols-outlined[^>]*>/gs)) {
        if (!m[0].includes("aria-hidden")) {
          offenders.push(`${path}:${src.slice(0, m.index).split("\n").length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// design-system.md section 2: the eyebrow, a mono label at 10px with wide
// tracking, is the ONE permitted use of upper case.
describe("typography", () => {
  it("uses upper case only for the mono eyebrow", () => {
    const offenders = [];
    for (const [path, src] of sources) {
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (!/\buppercase\b/.test(line)) return;
        if (line.trim().startsWith("//")) return; // prose about the word, not a class
        // A class string can be split across lines, so the eyebrow's other two
        // halves may sit on the neighbours.
        const window = [lines[i - 1], line, lines[i + 1]].join(" ");
        if (/font-mono/.test(window) && /tracking-\[0\.1[0-9]em\]/.test(window)) return;
        offenders.push(`${path}: ${line.trim().slice(0, 80)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

// design-system.md section 5: duration 120 to 180ms, easing a standard ease-out.
// Tailwind's default curve is ease-in-out, so a bare `transition-colors` eased
// in as well as out until the default was re-pointed.
describe("motion", () => {
  it("sets the default transition to a 150ms ease-out", () => {
    expect(css).toMatch(/--default-transition-duration: 150ms;/);
    expect(css).toMatch(/--default-transition-timing-function: cubic-bezier\(0, 0, 0\.2, 1\);/);
  });
});

// design-system.md section 3 names the densities by row height, not by padding.
describe("table density", () => {
  it("states a row height for each density", () => {
    const table = readFileSync(resolve(root, "src/shared/components/Table.js"), "utf8");
    expect(table).toMatch(/observation: "\[&_tr\]:h-8/);
    expect(table).toMatch(/configuration: "\[&_tr\]:h-11/);
  });

  it("no control paints a shadow outside a floating layer", () => {
    // design-system.md section 4: "Elevation is expressed by ground, line and
    // inset, not by shadow. One shadow token remains, a single hairline for a
    // genuinely floating layer." `shadow-elev` is that hairline; `shadow-soft`
    // was the ambient one and is gone.
    const offenders = [];
    for (const [file, src] of sources) {
      if (src.includes("shadow-soft")) offenders.push(file.slice(root.length + 1));
    }
    expect(offenders).toEqual([]);
  });

  it("no hover blends the control toward its ground", () => {
    // design-system.md section 1: "An alpha-based hover is forbidden, since
    // blending toward whatever sits behind the control lowers label contrast
    // exactly when the pointer is on it."
    const offenders = [];
    for (const [file, src] of sources) {
      const hit = src.match(/hover:bg-[a-z-]+\/\d+/g);
      if (hit) offenders.push(`${file.slice(root.length + 1)}: ${hit.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("no focus outline is removed without the ring that replaces it", () => {
    // design-system.md section 6: focus "is never removed without a replacement
    // that paints an indicator". `focus:outline-none` relied on class order
    // against globals.css, which is a coin flip, so it is gone entirely.
    const offenders = [];
    for (const [file, src] of sources) {
      if (src.includes("focus:outline-none")) offenders.push(file.slice(root.length + 1));
    }
    expect(offenders).toEqual([]);
  });

  it("type never falls below the two floors", () => {
    // design-system.md section 2: "Body text is never below 12.5 pixels, and the
    // technical face is never below 10.5 pixels." An arbitrary size under 10.5
    // fails outright; one at 10.5 has to be on the technical face.
    const offenders = [];
    for (const [file, src] of sources) {
      for (const [i, line] of src.split("\n").entries()) {
        for (const m of line.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
          // A glyph is not type: an icon span carries its size on the same
          // line as the Material Symbols class and is not read as text.
          if (line.includes("material-symbols")) continue;
          // The eyebrow is specified at 10px: "a mono label at 10 pixels with
          // wide tracking and upper case" (section 2). It is the one exception.
          if (line.includes("font-mono") && line.includes("uppercase")) continue;
          const px = Number(m[1]);
          if (px < 10.5) offenders.push(`${file.slice(root.length + 1)}:${i + 1} ${m[0]}`);
          else if (px < 12.5 && !/font-mono|metric|tabular-nums|<code/.test(line))
            offenders.push(`${file.slice(root.length + 1)}:${i + 1} ${m[0]} not on the technical face`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("spacing utilities stay on the eight-step scale", () => {
    // design-system.md section 3: "The spacing scale is 4, 6, 8, 12, 16, 22, 32,
    // 48. Nothing between." Tailwind's step is 4px, so a step maps to px by x4.
    // Only values inside the scale's range are checked: a landing-page section
    // gap of 96px is above the top of the scale, not a value between two of its
    // steps, and the scale does not claim to name every large layout distance.
    const scale = new Set([0, 4, 6, 8, 12, 16, 22, 32, 48]);
    const util = /(?<![\w-])-?(?:p|px|py|pt|pb|ps|pe|pl|pr|m|mx|my|mt|mb|ms|me|ml|mr|gap|gap-x|gap-y|space-x|space-y)-(\d+(?:\.\d+)?)(?![\w.])/g;
    const offenders = [];
    for (const [file, src] of sources) {
      for (const [i, line] of src.split("\n").entries()) {
        for (const m of line.matchAll(util)) {
          const px = Number(m[1]) * 4;
          if (px > 48 || scale.has(px)) continue;
          offenders.push(`${file.slice(root.length + 1)}:${i + 1} ${m[0]} = ${px}px`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

});
