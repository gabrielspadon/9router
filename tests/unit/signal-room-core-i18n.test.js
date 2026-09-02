import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const locales = ["de", "vi", "ja", "fa", "zh-CN"];
const coreLabels = ["Statistics", "Connect a Provider", "Catalog Provider", "New Models", "more"];

describe("Signal Room core route translations", () => {
  it("covers watch and provider-connection labels in every audited locale", () => {
    for (const locale of locales) {
      const map = JSON.parse(readFileSync(
        new URL(`../../public/i18n/literals/${locale}.json`, import.meta.url),
        "utf8",
      ));
      for (const label of coreLabels) {
        expect(map[label], `${locale} must translate ${label}`).toBeTruthy();
      }
    }
  });
});
