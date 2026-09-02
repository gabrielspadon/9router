import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const section = read("../../src/app/(dashboard)/dashboard/providers/[id]/CompatibleModelsSection.js");
const page = read("../../src/app/(dashboard)/dashboard/providers/[id]/page.js");
const listing = read("../../src/app/api/v1/models/route.js");

// For a custom OpenAI-compatible provider the models section offered copy, test
// and delete, and no way to keep a model out of /v1/models short of deleting it
// (#3135). The store, the endpoint and the listing filter all existed already
// and were used by the built-in provider page; this section never received them.
describe("a compatible provider's models can be disabled (#3135)", () => {
  it("the section takes the disabled ids and both handlers", () => {
    expect(section).toContain("disabledModelIds, onDisableModel, onEnableModel }");
    expect(section).toContain("const disabledSet = new Set(disabledModelIds || []);");
  });

  it("the row toggles in the direction its current state implies", () => {
    expect(section).toContain("disabledSet.has(id) ? onEnableModel(id) : onDisableModel(id)");
    // No control at all when the page does not supply the handlers, rather than
    // a dead button.
    expect(section).toContain("onDisableModel && onEnableModel");
  });

  it("the page passes the state it already had", () => {
    expect(page).toContain("disabledModelIds={disabledModelIds}");
    expect(page).toContain("onDisableModel={handleDisableModel}");
    expect(page).toContain("onEnableModel={handleEnableModel}");
  });

  it("no new persistence was introduced: the existing endpoint is reused", () => {
    // handleDisableModel/handleEnableModel post to /api/models/disabled, which
    // writes the same store /v1/models filters on.
    expect(page).toContain('fetch("/api/models/disabled", {');
    expect(listing).toContain('import { getDisabledModels } from "@/lib/disabledModelsDb";');
  });

  it("the listing really does filter on that store for a compatible connection", () => {
    // This is the line that makes the control take effect, so it is worth
    // pinning: it is inside the per-connection loop, which is the path a
    // compatible provider takes.
    expect(listing).toContain("if (isDisabled(outputAlias, modelId) || isDisabled(staticAlias, modelId)) continue;");
  });

  it("the accessible name says which way the control goes", () => {
    expect(section).toContain('aria-label={isDisabled ? "Enable model" : "Disable model"}');
  });
});
