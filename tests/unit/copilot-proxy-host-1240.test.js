import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Copilot talks to two hosts. Only api.individual.githubcopilot.com was
// registered, so requests to proxy.individual.githubcopilot.com were never
// redirected through the MITM layer.
const FILES = [
  "src/shared/constants/mitmToolHosts.js",
  "cli/hooks/cleanupMitmHosts.js",
  "src/mitm/config.js",
  "open-sse/utils/proxyFetch.js",
];
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("both Copilot hosts are redirected (#1240)", () => {
  it.each(FILES)("%s registers the proxy host beside the api host", (f) => {
    const src = read(f);
    expect(src).toContain("api.individual.githubcopilot.com");
    expect(src, `${f} knows the api host but not the proxy host`).toContain("proxy.individual.githubcopilot.com");
  });

  it("maps the proxy host to the copilot tool, not just to the host list", () => {
    // A host in the intercept list but absent from the tool mapping is
    // intercepted and then attributed to no tool.
    const cfg = read("src/mitm/config.js");
    expect(cfg).toContain('h === "proxy.individual.githubcopilot.com"');
    expect(cfg).toMatch(/proxy\.individual\.githubcopilot\.com"\) return "copilot"/);
  });

  it("every file that knows one host knows both, so cleanup matches setup", () => {
    // Asymmetry here leaves a hosts-file entry behind on uninstall.
    for (const f of FILES) {
      const src = read(f);
      const api = (src.match(/api\.individual\.githubcopilot\.com/g) || []).length;
      const proxy = (src.match(/proxy\.individual\.githubcopilot\.com/g) || []).length;
      expect(proxy, `${f}: ${api} api entries but ${proxy} proxy entries`).toBe(api);
    }
  });
});
