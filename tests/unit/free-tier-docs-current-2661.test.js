import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
const providers = readFileSync(new URL("../../docs/providers.md", import.meta.url), "utf8");

// The README's free-provider section carried outdated claims about Kiro, Qwen
// and Gemini CLI. The section is gone and the content lives in docs/providers.md
// with current figures; this pins the three facts so they cannot silently rot
// back, and pins that the README does not grow a second copy to drift from.
describe("free-tier provider documentation is current (#2661)", () => {
  it("Kiro is documented as paid with its credit cap, not as unlimited free", () => {
    expect(providers).toMatch(/Kiro moved to a paid model/i);
    expect(providers).toMatch(/50 credits per month/i);
  });

  it("Qwen Code's free OAuth tier is marked discontinued with its date", () => {
    expect(providers).toMatch(/Qwen Code free OAuth tier was discontinued/i);
    expect(providers).toMatch(/2026-04-15/);
  });

  it("Gemini CLI is marked shut down and names its replacement", () => {
    expect(providers).toMatch(/Gemini\s*\n?CLI was shut down/i);
    expect(providers).toMatch(/2026-06-18/);
    expect(providers).toMatch(/Antigravity CLI/i);
  });

  it("they sit under a heading that says not to plan around them", () => {
    const section = providers.slice(providers.indexOf("### Discontinued free tiers"));
    expect(section.slice(0, 400)).toMatch(/Do not plan around these/i);
  });

  it("the README does not carry a second, drifting copy", () => {
    // The stale text lived in a README free-provider section. One home only.
    expect(readme).not.toMatch(/Free Providers/i);
    expect(readme).toContain("Documentation");
  });
});
