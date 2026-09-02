import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const adhoc = readFileSync(new URL("../../src/app/api/combos/test/route.js", import.meta.url), "utf8");
const saved = readFileSync(new URL("../../src/app/api/combos/[id]/test/route.js", import.meta.url), "utf8");
const individual = readFileSync(new URL("../../src/app/api/providers/[id]/test/route.js", import.meta.url), "utf8");
const routes = { "ad-hoc": adhoc, saved };

// Testing providers individually returned 200 while testing them through a combo
// returned 500. The two paths are not comparable: the individual test calls the
// upstream directly, the combo test self-calls the gateway over loopback. A
// throw in that self-call (refused connection, timeout) was caught by the route's
// outer handler and became a bare 500 for the whole combo, with no indication of
// which member failed.
describe("one failing combo member does not 500 the whole test (#1874)", () => {
  for (const [name, src] of Object.entries(routes)) {
    it(`${name}: a throwing ping becomes a failed step`, () => {
      expect(src).toContain("pingRes = await pingModelByKind(");
      expect(src).toContain("pingRes = { ok: false, status: 0");
      expect(src).toContain("Ping threw:");
    });

    it(`${name}: the guard is inside the per-model loop, not around it`, () => {
      const loop = src.indexOf("for (let i = 0;");
      const guard = src.indexOf("pingRes = await pingModelByKind(");
      const outer = src.lastIndexOf("} catch (error) {");
      expect(loop).toBeGreaterThan(0);
      expect(guard).toBeGreaterThan(loop);
      expect(outer).toBeGreaterThan(guard);
    });

    it(`${name}: self-calls the port the request arrived on`, () => {
      expect(src).toContain("new URL(request.url).port");
      expect(src).toContain("requestPort || process.env.PORT || UPDATER_CONFIG.appPort");
      // Still loopback: the /v1 auth exemption depends on it.
      expect(src).toContain("http://127.0.0.1:${");
    });
  }

  it("the individual test really does take a different path, which is the asymmetry", () => {
    expect(individual).toContain("testSingleConnection");
    expect(individual).not.toContain("pingModelByKind");
  });
});
