// Material Symbols render blank on first load (upstream 14401c433).
//
// `document.fonts.ready` resolves before the icon face has even started
// loading — the script runs in <head>, ahead of any element that triggers the
// lazy fetch — so `fonts-loaded` landed early and icons stayed blank.
//
// Two halves are pinned here. The stylesheet half is read off globals.css.
// The script half is EXECUTED: the inline <head> script is extracted from
// layout.js and run against a stub document, so the 3s fallback is proven to
// reveal the UI rather than merely asserted to be present in the source. A
// broken fallback hides the entire interface, which is the failure this guards.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const css = readFileSync(resolve(root, "src/app/globals.css"), "utf8");
const layout = readFileSync(resolve(root, "src/app/layout.js"), "utf8");

const SCRIPT = (() => {
  const m = layout.match(/const ICON_FONT_READY_SCRIPT = `([\s\S]*?)`;/);
  if (!m) throw new Error("ICON_FONT_READY_SCRIPT not found in src/app/layout.js");
  return m[1];
})();

// Minimal stand-in for the parts of `document` the inline script touches.
function stubDocument(fonts) {
  const classes = new Set();
  return {
    classes,
    document: {
      fonts,
      documentElement: { classList: { add: (c) => classes.add(c) } },
    },
  };
}

const run = (doc) => new Function("document", SCRIPT)(doc);
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe("globals.css icon reveal", () => {
  it("hides the ligature with opacity, not visibility", () => {
    expect(css).toMatch(/\.material-symbols-outlined\s*\{[^}]*opacity:\s*0/);
    expect(css).not.toMatch(/\.material-symbols-outlined\s*\{[^}]*visibility:\s*hidden/);
  });

  it("reveals the ligature once the font class lands", () => {
    expect(css).toMatch(/\.fonts-loaded\s+\.material-symbols-outlined\s*\{[^}]*opacity:\s*1/);
    expect(css).not.toMatch(/\.fonts-loaded\s+\.material-symbols-outlined\s*\{[^}]*visibility:\s*visible/);
  });
});

describe("layout.js icon font script", () => {
  it("is the script the document head renders", () => {
    expect(layout).toMatch(/__html:\s*ICON_FONT_READY_SCRIPT/);
  });

  it("waits on the icon face itself, not on document.fonts.ready", () => {
    expect(SCRIPT).toContain("Material Symbols Outlined");
    expect(SCRIPT).not.toContain("fonts.ready");
  });

  it("requests the Material Symbols face and reveals once it loads", async () => {
    const requested = [];
    const { document, classes } = stubDocument({
      load: (spec) => {
        requested.push(spec);
        return Promise.resolve([]);
      },
    });
    run(document);
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain("Material Symbols Outlined");
    await flush();
    expect(classes.has("fonts-loaded")).toBe(true);
  });

  it("reveals anyway when the font load rejects", async () => {
    const { document, classes } = stubDocument({ load: () => Promise.reject(new Error("offline")) });
    run(document);
    await flush();
    expect(classes.has("fonts-loaded")).toBe(true);
  });

  it("reveals after 3s when the font load never settles", () => {
    vi.useFakeTimers();
    const { document, classes } = stubDocument({ load: () => new Promise(() => {}) });
    run(document);
    expect(classes.has("fonts-loaded")).toBe(false);
    vi.advanceTimersByTime(2999);
    expect(classes.has("fonts-loaded")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(classes.has("fonts-loaded")).toBe(true);
  });

  it("reveals immediately where the FontFaceSet API is absent", () => {
    const { document, classes } = stubDocument(undefined);
    run(document);
    expect(classes.has("fonts-loaded")).toBe(true);
  });
});
