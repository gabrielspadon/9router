import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(), getProviderConnections: vi.fn(), updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(), toConnectionProxyOptions: vi.fn(),
}));
vi.mock("@/app/api/usage/[connectionId]/route.js", () => ({ refreshAndUpdateCredentials: vi.fn() }));

const { cheapestPingModel } = await import("@/shared/services/quotaAutoPing");
const {
  QUOTA_AUTOPING_CONFIG,
  QUOTA_AUTOPING_SETTINGS_KEY_BY_PROVIDER,
  quotaAutoPingSupportsAuthType,
} = await import("@/shared/constants/config");

const PROVIDERS = Object.keys(QUOTA_AUTOPING_CONFIG.providers);

describe("every configured provider can actually be warmed", () => {
  // The alias trap: PROVIDER_MODELS is keyed by the registry ALIAS ("cc",
  // "cx", "ag") while the scheduler holds a provider ID, and PROVIDERS[id]
  // carries no `alias` field to bridge them — buildTransport drops it. A
  // lookup written against that field resolved to an empty registry for
  // every aliased provider, and only kimi worked because its alias equals
  // its id. Warming with no model is a silent no-op, so this asserts a
  // model resolves rather than asserting which one.
  it.each(PROVIDERS)("%s resolves a ping model", (provider) => {
    const cfg = QUOTA_AUTOPING_CONFIG.providers[provider];
    expect(cheapestPingModel(provider, cfg)).toBeTruthy();
  });

  it.each(PROVIDERS)("%s resolves a ping model without a configured one", (provider) => {
    // pingModel is optional (antigravity and kimi declare none), so the
    // registry fallback is the real path for them and must not be empty.
    expect(cheapestPingModel(provider, {})).toBeTruthy();
  });

  it.each(PROVIDERS)("%s is reachable from the dashboard toggle", (provider) => {
    // Two dashboards each carried a hardcoded {claude, codex} map, so a
    // provider configured and scheduled here had no toggle anywhere and
    // could never be enabled.
    expect(QUOTA_AUTOPING_SETTINGS_KEY_BY_PROVIDER[provider]).toBeTruthy();
    const authTypes = QUOTA_AUTOPING_CONFIG.providers[provider].authTypes || ["oauth"];
    for (const authType of authTypes) {
      expect(quotaAutoPingSupportsAuthType(provider, authType)).toBe(true);
    }
  });

  it("gates an auth type the provider does not carry", () => {
    // kimi is the one provider metered on an API key; claude is not, and the
    // old `authType === "oauth"` literal would have said yes to both.
    expect(quotaAutoPingSupportsAuthType("kimi", "api_key")).toBe(true);
    expect(quotaAutoPingSupportsAuthType("claude", "api_key")).toBe(false);
    expect(quotaAutoPingSupportsAuthType("not-a-provider", "oauth")).toBe(false);
  });
});
