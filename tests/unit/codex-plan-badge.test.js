import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConnectionRow, {
  getPersistedCodexPlan,
} from "@/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js";

const nativeFetch = globalThis.fetch;
const noop = () => {};

function connection(provider, providerSpecificData = {}) {
  return {
    id: "connection-1",
    provider,
    authType: "oauth",
    name: "Account",
    priority: 1,
    isActive: true,
    providerSpecificData,
  };
}

function renderRow(rowConnection) {
  return renderToStaticMarkup(createElement(ConnectionRow, {
    connection: rowConnection,
    proxyPools: [],
    isOAuth: true,
    isFirst: true,
    isLast: true,
    onMoveUp: noop,
    onMoveDown: noop,
    onToggleActive: noop,
    onUpdateProxy: noop,
    onEdit: noop,
    onDelete: noop,
  }));
}

afterEach(() => {
  globalThis.fetch = nativeFetch;
});

describe("Codex persisted plan badge", () => {
  it.each([
    ["prefers a valid persisted Codex plan", "codex", {
      codexSubscriptionPlan: " Pro ", chatgptPlanType: "Plus",
    }, "Pro"],
    ["falls back when the preferred plan is missing", "codex", {
      chatgptPlanType: " Plus ",
    }, "Plus"],
    ["falls back when the preferred plan is a number", "codex", {
      codexSubscriptionPlan: 1, chatgptPlanType: "Plus",
    }, "Plus"],
    ["falls back when the preferred plan is an object", "codex", {
      codexSubscriptionPlan: { tier: "pro" }, chatgptPlanType: "Plus",
    }, "Plus"],
    ["falls back when the preferred plan is blank", "codex", {
      codexSubscriptionPlan: " ", chatgptPlanType: " Plus ",
    }, "Plus"],
    ["falls back when the preferred plan is case-folded unknown", "codex", {
      codexSubscriptionPlan: " UnKnOwN ", chatgptPlanType: " Plus ",
    }, "Plus"],
    ["hides two unusable plans", "codex", {
      codexSubscriptionPlan: " ", chatgptPlanType: "UNKNOWN",
    }, null],
    ["hides Codex-shaped metadata on a non-Codex connection", "openai", {
      codexSubscriptionPlan: "Pro", chatgptPlanType: "Plus",
    }, null],
  ])("%s", (_name, provider, providerSpecificData, expected) => {
    expect(getPersistedCodexPlan(
      connection(provider, providerSpecificData),
    )).toBe(expected);
  });

  it("renders the accessible persisted badge without fetching", () => {
    const fetchSpy = vi.fn(() => { throw new Error("render must not fetch"); });
    globalThis.fetch = fetchSpy;
    const markup = renderRow(connection("codex", {
      codexSubscriptionPlan: " Pro ",
      chatgptPlanType: "Plus",
    }));

    expect(markup).toContain("Pro");
    expect(markup).toContain("Codex subscription plan");
    expect(markup).toContain("sr-only");
    expect(markup).toContain("bg-brand-soft");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("omits the badge for a non-Codex row without fetching", () => {
    const fetchSpy = vi.fn(() => { throw new Error("render must not fetch"); });
    globalThis.fetch = fetchSpy;
    const markup = renderRow(connection("openai", {
      codexSubscriptionPlan: "Pro",
      chatgptPlanType: "Plus",
    }));

    expect(markup).not.toContain("Codex subscription plan");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
