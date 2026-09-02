import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const route = read("../../src/app/api/providers/[id]/test-models/route.js");
const providerPage = read("../../src/app/(dashboard)/dashboard/providers/[id]/page.js");
const compatible = read("../../src/app/(dashboard)/dashboard/providers/[id]/CompatibleModelsSection.js");

// The bulk endpoint implemented "test every model on this connection" exactly as
// #1109 asks for, and nothing in the app ever called it: the only occurrence of
// the path in the tree was the route's own docstring. Per-model test buttons
// existed, so the capability was reachable only one model at a time.
describe("one-click test all models (#1109)", () => {
  const callSites = { "provider detail page": providerPage, "compatible models section": compatible };

  for (const [name, src] of Object.entries(callSites)) {
    it(`${name} calls the bulk endpoint`, () => {
      expect(src).toContain("/test-models`, { method: \"POST\" }");
    });

    it(`${name} resolves the connection id from an ACTIVE connection`, () => {
      // The route keys on connectionId. An inactive connection has no usable
      // credential, so picking connections[0] would test against a dead account.
      expect(src).toMatch(/connections\.find\(\(conn\) => conn\.isActive !== false\)/);
    });

    it(`${name} merges the per-model verdicts into the existing status map`, () => {
      // Merge, never replace: the map also holds verdicts from the per-model
      // buttons, and the bulk list does not cover custom or Kilo-free rows.
      expect(src).toContain("merged[r.modelId] = r.ok ? \"ok\" : \"error\"");
      expect(src).toContain("setModelTestResults((prev) => ({ ...prev, ...merged }))");
    });
  }

  it("the route self-calls the port the request arrived on", () => {
    // Same defect the combo test routes carried (#1874): reconstructing the port
    // from process.env.PORT falls back to the 20128 default whenever the server
    // was started without PORT set, and every ping is refused. Latent while the
    // route was unreachable; live the moment it has a caller.
    expect(route).toContain("new URL(request.url).port");
    expect(route).toContain("requestPort || process.env.PORT || UPDATER_CONFIG.appPort");
    expect(route).toContain("http://127.0.0.1:${");
  });

  it("the serial warm-up of the first model survives", () => {
    // The reason to reuse this endpoint rather than Promise.all the existing
    // single-model endpoint client-side: the first ping is awaited alone so a
    // token refresh happens once instead of racing across every model.
    const warm = route.indexOf("const firstResult = await pingModelByKind(");
    const rest = route.indexOf("rest.map(async (model)");
    expect(warm).toBeGreaterThan(0);
    expect(rest).toBeGreaterThan(warm);
  });
});
