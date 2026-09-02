import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");

// The image had no HEALTHCHECK, so an orchestrator could only tell that the
// container process was alive, not that the gateway was serving (#3096).
describe("the image reports its own health (#3096)", () => {
  it("declares a HEALTHCHECK", () => {
    expect(dockerfile).toMatch(/^HEALTHCHECK /m);
  });

  it("probes the health route that actually exists", () => {
    expect(dockerfile).toContain("path:'/api/health'");
    expect(existsSync(new URL("../../src/app/api/health/route.js", import.meta.url))).toBe(true);
  });

  it("uses node, not a tool the image deliberately removed", () => {
    // The Dockerfile deletes npm/npx/corepack/yarn and the base has no curl, so
    // a curl- or npm-based probe would fail in the built image rather than in CI.
    const line = dockerfile.match(/^HEALTHCHECK[\s\S]*?\n\n/m)[0];
    expect(line).toContain("CMD node -e");
    expect(line).not.toMatch(/curl|wget|npm|npx/);
  });

  it("honours PORT so a remapped container still reports healthy", () => {
    expect(dockerfile).toContain("port:process.env.PORT||20128");
  });

  it("gives the standalone server time to boot before failing", () => {
    expect(dockerfile).toMatch(/--start-period=\d+s/);
    expect(dockerfile).toMatch(/--retries=\d+/);
  });
});
