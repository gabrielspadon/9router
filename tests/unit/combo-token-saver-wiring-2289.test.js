import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveComboTokenSaver } from "open-sse/services/combo.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const chat = readFileSync(join(root, "src/sse/handlers/chat.js"), "utf8");

const GLOBAL = {
  rtkEnabled: true,
  headroomEnabled: true,
  cavemanEnabled: false,
  ponytailEnabled: false,
  pxpipeEnabled: true,
};

describe("a combo's token-saver overrides reach the handler (#2289, #2037)", () => {
  it("the handler resolves them instead of reading the global flags directly", () => {
    expect(chat).toContain("const comboTokenSaver = resolveComboTokenSaver(comboChain, chatSettings);");
    for (const flag of ["rtkEnabled", "headroomEnabled", "cavemanEnabled", "ponytailEnabled", "pxpipeEnabled"]) {
      expect(chat, flag).toContain(`${flag}: comboTokenSaver.${flag},`);
      expect(chat, flag).not.toContain(`${flag}: !!chatSettings.${flag},`);
    }
  });

  it("the expensive lazy load follows the resolved flag, not the global one", () => {
    // Warming that module for a combo that has the saver off would pay a cost
    // the override exists to avoid.
    expect(chat).toContain("comboTokenSaver.pxpipeEnabled ? await getPxpipeTransform() : null");
  });

  it("a request outside a combo resolves to the global settings unchanged", () => {
    expect(resolveComboTokenSaver(null, GLOBAL)).toEqual(GLOBAL);
  });

  it("a combo that declares nothing behaves exactly as today", () => {
    const settings = { ...GLOBAL, comboStrategies: { mine: {} } };
    expect(resolveComboTokenSaver(new Set(["mine"]), settings)).toEqual(GLOBAL);
  });

  it("a combo overrides only the flags it names", () => {
    const settings = { ...GLOBAL, comboStrategies: { mine: { tokenSaver: { rtk: false } } } };
    expect(resolveComboTokenSaver(new Set(["mine"]), settings)).toEqual({ ...GLOBAL, rtkEnabled: false });
  });

  it("a combo can turn the whole saver off in one flag", () => {
    const settings = { ...GLOBAL, comboStrategies: { mine: { tokenSaver: { enabled: false } } } };
    expect(Object.values(resolveComboTokenSaver(new Set(["mine"]), settings)).every((v) => v === false)).toBe(true);
  });
});
