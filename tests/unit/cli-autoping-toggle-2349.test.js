import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { autoPingIsOn, nextAutoPingConfig } from "../../cli/src/cli/menus/settings.js";

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

  it("it follows the existing toggle shape in this menu", () => {
    // rtkEnabled and headroomEnabled established it; a third spelling would be
    // the thing to avoid here.
    for (const fn of ["toggleRtk", "toggleHeadroom", "toggleAutoPing"]) {
      expect(menu).toContain(`async function ${fn}(`);
    }
  });
});

// THE TOGGLE'S WRITE, exercised rather than grepped for. Every assertion above
// reads the file as text, which is why the bug below survived them: the string
// the menu contained was exactly the string this suite asked for, and it was
// the wrong write. rtkEnabled and headroomEnabled really are booleans, so
// following their shape — which this suite pinned — is what broke auto-ping.
describe("the CLI toggle writes the shape the scheduler reads", () => {
  const CFG = { enabled: false, connections: { a: false, b: false } };

  it("keeps the per-connection map, which is the only gate the tick has", () => {
    // updateSettings replaces a top-level key wholesale, so a bare boolean here
    // erased `connections` and the tick then skipped the provider entirely.
    const next = nextAutoPingConfig(CFG);
    expect(typeof next).toBe("object");
    expect(next.connections).toEqual({ a: true, b: true });
  });

  it("reads ON from the connection map, not from the unread `enabled` flag", () => {
    // Live settings carried `claudeAutoPing.enabled === false` while all 11
    // accounts warmed, because nothing reads that flag. A label keyed on it
    // reports the opposite of what the scheduler is doing.
    expect(autoPingIsOn({ enabled: false, connections: { a: true } })).toBe(true);
    expect(autoPingIsOn({ enabled: true, connections: { a: false } })).toBe(false);
    expect(autoPingIsOn(undefined)).toBe(false);
  });

  it("turns every enrolled account off, and back on again", () => {
    const on = nextAutoPingConfig(CFG);
    expect(autoPingIsOn(on)).toBe(true);
    const off = nextAutoPingConfig(on);
    expect(autoPingIsOn(off)).toBe(false);
    expect(Object.keys(off.connections)).toEqual(["a", "b"]);
  });

  it("refuses to write when no account is enrolled", () => {
    // An empty map would read back as enrolled-but-empty: the label says ON and
    // the tick skips the provider. Nothing to toggle is reported, not written.
    expect(nextAutoPingConfig({ enabled: true, connections: {} })).toBeNull();
    expect(nextAutoPingConfig(undefined)).toBeNull();
  });

  it("preserves sibling keys it does not own", () => {
    const next = nextAutoPingConfig({ ...CFG, someFutureKey: 7 });
    expect(next.someFutureKey).toBe(7);
  });
});
