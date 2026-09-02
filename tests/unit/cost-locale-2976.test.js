// #2976 — "Usage cost display should follow UI locale (CNY for Chinese, USD for
// English)". Every figure is USD (open-sse pricing is USD per million tokens),
// and the dashboard printed a bare "$", which a zh-CN reader reads as CNY.
//
// The formatter fixes the ambiguity unconditionally and makes conversion opt-in:
// the reporter's own 7.2 is a number that goes stale, and inventing it inside a
// figure already labelled "estimated" would make it unusable rather than
// localised. Pass a rate and the conversion happens; pass none and the amount
// stays USD, formatted in the reader's conventions.
import { describe, it, expect } from "vitest";
import { formatCost, currencyForLocale, BASE_CURRENCY } from "@/lib/currency.js";

// Intl inserts U+00A0 / U+202F around symbols in several locales; compare on
// the characters that carry the meaning, not on the spacing.
const compact = (s) => s.replace(/[  \s]/g, "");

describe("cost is formatted for the reader's locale (#2976)", () => {
  it("keeps the plain dollar for English", () => {
    expect(formatCost(0.2)).toBe("$0.20");
    expect(formatCost(0.2, { locale: "en" })).toBe("$0.20");
  });

  it("disambiguates the dollar for a locale that has its own", () => {
    // The reported confusion: "$0.20" in a Chinese UI reads as ¥0.20.
    expect(compact(formatCost(0.2, { locale: "zh-CN" }))).toBe("US$0.20");
    expect(formatCost(0.2, { locale: "zh-CN" })).not.toBe("$0.20");
  });

  it("converts and relabels only when a rate is supplied", () => {
    expect(compact(formatCost(0.2, { locale: "zh-CN", rate: 7.2 }))).toBe("¥1.44");
    expect(compact(formatCost(0.2, { locale: "zh-TW", rate: 32 }))).toBe("$6.40");
    expect(currencyForLocale("zh-TW")).toBe("TWD");
  });

  it("ignores a rate that cannot be a rate", () => {
    for (const rate of [null, undefined, 0, -1, NaN, Infinity, "7.2"]) {
      expect(compact(formatCost(0.2, { locale: "zh-CN", rate }))).toBe("US$0.20");
    }
  });

  it("never converts the base currency against itself", () => {
    expect(formatCost(0.2, { locale: "en", rate: 7.2 })).toBe("$0.20");
    expect(currencyForLocale("en")).toBe(BASE_CURRENCY);
  });

  it("keeps 4 decimals for a per-call cost, the way the chart needs", () => {
    expect(formatCost(0.0001, { decimals: 4 })).toBe("$0.0001");
    // Unconverted it is still USD, just written the Japanese way.
    expect(compact(formatCost(0.0001, { locale: "ja", decimals: 4 }))).toBe("$0.0001");
    // JPY's own default is 0 fraction digits; the explicit request still wins,
    // so a tiny per-call figure does not collapse to zero after conversion.
    expect(compact(formatCost(0.0001, { locale: "ja", decimals: 4, rate: 150 }))).toBe("￥0.0150");
  });

  it("treats a missing or unusable amount as zero, as every call site did", () => {
    expect(formatCost(null)).toBe("$0.00");
    expect(formatCost(undefined)).toBe("$0.00");
    expect(formatCost(NaN)).toBe("$0.00");
    expect(formatCost("0.5")).toBe("$0.00");
  });

  it("falls back to USD for a locale whose currency the tag does not pin", () => {
    // Spanish and Arabic span several currency zones; guessing one would be a
    // worse answer than the honest base unit.
    for (const locale of ["es", "ar", "en-GB", "sw"]) {
      expect(currencyForLocale(locale)).toBe(BASE_CURRENCY);
    }
    expect(currencyForLocale("ja")).toBe("JPY");
    expect(currencyForLocale("pt-BR")).toBe("BRL");
    expect(currencyForLocale("de")).toBe("EUR");
  });

  it("renders something for a corrupt locale cookie instead of throwing", () => {
    expect(() => formatCost(1, { locale: "not a tag" })).not.toThrow();
    expect(formatCost(1, { locale: "not a tag" })).toBe("$1.00");
    expect(formatCost(1, { locale: "" })).toBe("$1.00");
  });

  it("uses the reader's own grouping and decimal marks", () => {
    expect(compact(formatCost(1234.5, { locale: "de" }))).toBe("1.234,50$");
  });
});
