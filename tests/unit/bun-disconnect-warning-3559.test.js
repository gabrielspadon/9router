import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../custom-server.js", import.meta.url), "utf8");

// Bun's node:http compat exposes no disconnect signal at all, so an abandoned
// streaming request keeps the upstream running and billing (#3559). The gap
// cannot be closed from here; the one thing that can be fixed is that it used
// to happen silently.
describe("the Bun disconnect gap is announced, not silent (#3559)", () => {
  it("start-up warns when the runtime is Bun", () => {
    expect(src).toContain("typeof globalThis.Bun !== 'undefined'");
    const i = src.indexOf("typeof globalThis.Bun !== 'undefined'");
    const block = src.slice(i, i + 500);
    expect(block).toContain("console.warn");
    expect(block).toMatch(/billing/);
  });

  it("it names the runtime that does work, so the warning is actionable", () => {
    const i = src.indexOf("typeof globalThis.Bun !== 'undefined'");
    expect(src.slice(i, i + 500)).toMatch(/on Node/);
  });

  it("nothing bridges req or socket events into a synthetic response close", () => {
    // req 'close' fires at BODY completion on a healthy POST on both runtimes,
    // so bridging it would abort every working stream. Measured, not assumed.
    expect(src).not.toContain("res.emit('close')");
    expect(src).not.toContain('res.emit("close")');
  });

  it("the warning is emitted once at module scope, not per request", () => {
    const i = src.indexOf("typeof globalThis.Bun !== 'undefined'");
    const wrapped = src.indexOf("const wrapped = (req, res) =>");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(wrapped);
  });
});
