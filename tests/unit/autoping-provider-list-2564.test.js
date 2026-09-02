import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  QUOTA_AUTOPING_CONFIG,
  QUOTA_AUTOPING_PROVIDERS,
  QUOTA_AUTOPING_SETTINGS_KEYS,
} from "@/shared/constants/config";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

describe("the auto-ping provider list has one source (#2564)", () => {
  it("derives every settings key from the table", () => {
    const expected = Object.values(QUOTA_AUTOPING_CONFIG.providers).map((p) => p.settingsKey);
    expect(QUOTA_AUTOPING_SETTINGS_KEYS).toEqual(expected);
    expect(QUOTA_AUTOPING_SETTINGS_KEYS.length).toBeGreaterThan(2);
  });

  it("pairs each key with its provider id", () => {
    for (const { id, settingsKey } of QUOTA_AUTOPING_PROVIDERS) {
      expect(QUOTA_AUTOPING_CONFIG.providers[id].settingsKey).toBe(settingsKey);
    }
    expect(QUOTA_AUTOPING_PROVIDERS.map((p) => p.settingsKey)).toEqual(QUOTA_AUTOPING_SETTINGS_KEYS);
  });

  it("the settings write reconfigures on any of them, not two named ones", () => {
    const route = read("src/app/api/settings/route.js");
    expect(route).toContain("QUOTA_AUTOPING_SETTINGS_KEYS.some((key)");
    expect(route).not.toContain('hasOwnProperty.call(body, "codexAutoPing")');
  });

  it("the boot check reads all of them", () => {
    const boot = read("src/shared/services/initializeApp.js");
    expect(boot).toContain("QUOTA_AUTOPING_SETTINGS_KEYS");
    expect(boot).not.toContain("settings?.codexAutoPing");
  });

  it("the launcher menu is generated from what the server reports", () => {
    // The launcher is CommonJS and cannot import the table, so the list is
    // served to it rather than duplicated there.
    const route = read("src/app/api/settings/route.js");
    expect(route).toContain("quotaAutoPingProviders: QUOTA_AUTOPING_PROVIDERS");
    const menu = read("cli/src/cli/menus/settings.js");
    expect(menu).toContain("quotaAutoPingProviders");
    expect(menu).not.toContain('toggleAutoPing("codexAutoPing"');
  });

  it("the menu helper accepts a generated item list without breaking a static one", () => {
    const helper = read("cli/src/cli/utils/menuHelper.js");
    expect(helper).toContain('typeof items === "function" ? (items(refreshedData) || []) : items');
    expect(helper).toContain("resolvedItems[actionIndex]");
  });
});
