import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ProviderLimitCard from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/ProviderLimitCard.js";

const render = (quota) =>
  renderToStaticMarkup(createElement(ProviderLimitCard, {
    provider: "antigravity",
    name: "Antigravity",
    quotas: [quota],
  }));

describe("ProviderLimitCard quota percentages", () => {
  it("renders the provider-reported remaining percentage instead of recomputing used and total", () => {
    const html = render({
      name: "requests",
      used: 0,
      total: 1000,
      remainingPercentage: 42,
    });

    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain("42% left");
  });
});
