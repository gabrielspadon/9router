import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const menu = read("../../cli/src/cli/menus/settings.js");
const settingsRoute = read("../../src/app/api/settings/route.js");

// Quota auto-ping was reachable only from the dashboard, so a headless install
// — the CLI's whole reason for existing — could not turn it on or off (#2349).
describe("the CLI can toggle quota auto-ping (#2349)", () => {
  it("offers a toggle for each provider the scheduler knows", () => {
    // Generated from what the settings API reports rather than listed here.
    // Naming the providers meant a newly configured one had no toggle at all
    // until this file was edited too (#2564).
    expect(menu).toContain("quotaAutoPingProviders");
    expect(menu).toContain("`Auto-ping (${name}):");
    expect(settingsRoute).toContain("quotaAutoPingProviders: QUOTA_AUTOPING_PROVIDERS");
  });

  it("writes the keys the settings API already owns", () => {
    expect(menu).toContain("toggleAutoPing(settingsKey, name,");
    expect(settingsRoute).toContain("QUOTA_AUTOPING_SETTINGS_KEYS.some((key)");
  });

  it("no new endpoint was added: it reuses updateSettings", () => {
    // The route reconfigures the scheduler on write, so the CLI needs no
    // scheduler knowledge and no state of its own.
    expect(menu).toContain("api.updateSettings({ [key]: next })");
    expect(settingsRoute).toContain("configureQuotaAutoPing(settings)");
  });

  it("the label reflects current state rather than assuming a default", () => {
    // Every key is opt-in, so an absent value must read OFF, not ON.
    expect(menu).toContain('d?.settings?.[settingsKey] === true ? "ON" : "OFF"');
  });

  it("it follows the existing toggle shape in this menu", () => {
    // rtkEnabled and headroomEnabled established it; a third spelling would be
    // the thing to avoid here.
    for (const fn of ["toggleRtk", "toggleHeadroom", "toggleAutoPing"]) {
      expect(menu).toContain(`async function ${fn}(`);
    }
  });
});
