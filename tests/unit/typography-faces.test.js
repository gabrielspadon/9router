import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const css = readFileSync(resolve(root, "src/app/globals.css"), "utf8");
const layout = readFileSync(resolve(root, "src/app/layout.js"), "utf8");

// The design system names three faces. Two of them were named in the document
// and in nothing else: `font-mono` resolved to whatever monospace the platform
// had, and headings were set in the interface face. A token that no font file
// backs is a promise, not a typeface.
describe("typography faces", () => {
  it("loads all three faces through next/font", () => {
    expect(layout).toMatch(/Inter_Tight/);
    expect(layout).toMatch(/JetBrains_Mono/);
    for (const v of ["--font-inter", "--font-inter-tight", "--font-jetbrains-mono"]) {
      expect(layout).toContain(v);
    }
  });

  it("applies every loaded face variable to the body", () => {
    const body = layout.match(/<body className=\{`([^`]+)`\}/);
    expect(body).not.toBeNull();
    expect(body[1]).toContain("inter.variable");
    expect(body[1]).toContain("interTight.variable");
    expect(body[1]).toContain("jetbrainsMono.variable");
  });

  it("routes each role token to its loaded face", () => {
    expect(css).toMatch(/--font-sans:\s*var\(--font-inter\)/);
    expect(css).toMatch(/--font-display:\s*var\(--font-inter-tight\)/);
    expect(css).toMatch(/--font-mono:\s*var\(--font-jetbrains-mono\)/);
  });

  it("sets headings in the display face without a per-heading utility", () => {
    expect(css).toMatch(/h1,\s*h2,\s*h3\s*\{[^}]*font-family:\s*var\(--font-display\)/);
  });

  it("leaves no private monospace stack outside the token", () => {
    const stacks = css.match(/font-family:[^;]*monospace[^;]*/g) || [];
    for (const s of stacks) expect(s).toContain("--font-mono");
  });
});
