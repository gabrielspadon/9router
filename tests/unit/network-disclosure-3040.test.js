import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const security = readFileSync(new URL("../../SECURITY.md", import.meta.url), "utf8");
const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
const layout = readFileSync(new URL("../../src/app/layout.js", import.meta.url), "utf8");

// A default-off toggle is not disclosure. The report's first ask was that the
// analytics id and the other first-party calls be written down where someone
// deciding whether to trust the binary with credentials will see them.
describe("outbound calls are disclosed, not just defaulted off (#3040)", () => {
  it("names the actual GA property, not just 'analytics'", () => {
    const gaId = layout.match(/gaId=\{"([^"]+)"\}/)?.[1];
    expect(gaId, "layout.js no longer sets a gaId; update this disclosure").toBeTruthy();
    expect(security, `SECURITY.md does not disclose ${gaId}`).toContain(gaId);
  });

  it("says analytics is off by default and gated on the setting", () => {
    expect(layout).toContain("settings.analyticsEnabled === true");
    expect(security).toMatch(/off by default/i);
  });

  it("lists the other first-party calls a reader would otherwise discover", () => {
    for (const host of ["registry.npmjs.org", "abc-tunnel.us", "api.cloudflare.com"]) {
      expect(security, `SECURITY.md omits ${host}`).toContain(host);
    }
  });

  it("states the limit: no prompts, responses or credentials leave", () => {
    expect(security).toMatch(/Nothing above carries prompts, responses, or provider credentials/);
  });

  it("tells the reader how to run with none of them", () => {
    expect(security).toMatch(/To run with no outbound calls of its own/);
  });

  it("is reachable from the README, not buried", () => {
    expect(readme).toContain("what talks to the network");
    expect(readme).toContain("SECURITY.md#what-talks-to-the-network-besides-your-providers");
  });

  it("the anchor the README links actually exists", () => {
    const heading = "## What talks to the network, besides your providers";
    expect(security).toContain(heading);
    const anchor = heading.replace(/^#+ /, "").toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
    expect(readme).toContain(`SECURITY.md#${anchor}`);
  });
});
