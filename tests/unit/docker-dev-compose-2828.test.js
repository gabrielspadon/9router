import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

// The dev override and the Dockerfile stage it targets are two files that must
// agree, and a mismatch only shows up as a build failure at `docker compose up`.
describe("docker dev override (#2828)", () => {
  const dockerfile = read("Dockerfile");
  const stages = [...dockerfile.matchAll(/^FROM\s+\S+\s+AS\s+(\S+)/gm)].map((m) => m[1]);

  it("declares a dev stage that the dev override targets", () => {
    expect(stages).toContain("dev");
    expect(read("docker-compose.dev.yml")).toMatch(/target:\s*dev\b/);
  });

  it("keeps production as the last stage, so a plain `docker build .` is unchanged", () => {
    expect(stages.at(-1)).toBe("runner");
  });

  it("does not tag the dev build as the published image", () => {
    const dev = read("docker-compose.dev.yml");
    const images = [...dev.matchAll(/^\s*image:\s*(\S+)/gm)].map((m) => m[1]);
    expect(images).toEqual(["tokenproxy-dev"]);
  });

  it("shadows node_modules and .next so the container never writes them to the host checkout", () => {
    const dev = read("docker-compose.dev.yml");
    expect(dev).toContain("- /app/node_modules");
    expect(dev).toContain("- /app/.next");
  });

  // Publishing a compose port on all interfaces is the footgun this fork keeps
  // closing; headroom's 8787 was open until #2828.
  it.each(["docker-compose.yml", "docker-compose.dev.yml"])(
    "%s publishes every port on loopback only",
    (file) => {
      const mappings = [...read(file).matchAll(/^\s*-\s*"([\d.:]+)"\s*$/gm)].map((m) => m[1]);
      expect(mappings.length).toBeGreaterThan(0);
      for (const m of mappings) expect(m.startsWith("127.0.0.1:")).toBe(true);
    },
  );
});
