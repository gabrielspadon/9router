import { describe, expect, it } from "vitest";

import {
  getEffectiveRefreshLeadMs,
  getRefreshLeadMs,
  MAX_CONNECTION_REFRESH_LEAD_MS,
} from "../../open-sse/services/tokenRefresh.js";
import { shouldRefreshCredentials } from "../../open-sse/services/oauthCredentialManager.js";
import { selectConnectionsNeedingRefresh } from "../../src/sse/services/backgroundTokenRefresh.js";

describe("per-connection refresh lead overrides", () => {
  it("uses a finite positive connection override for on-request refresh", () => {
    const nowMs = Date.now();
    const credentials = {
      refreshToken: "refresh-token",
      expiresAt: new Date(nowMs + 20 * 60 * 1000).toISOString(),
      providerSpecificData: { refreshLeadMs: 30 * 60 * 1000 },
    };

    expect(getRefreshLeadMs("grok-cli", credentials.providerSpecificData)).toBe(30 * 60 * 1000);
    expect(shouldRefreshCredentials("grok-cli", credentials, nowMs)).toBe(true);
  });

  it("uses the connection override in the background refresh selector", () => {
    const nowMs = Date.now();
    const connection = {
      id: "grok-connection",
      provider: "grok-cli",
      authType: "oauth",
      refreshToken: "refresh-token",
      expiresAt: new Date(nowMs + 45 * 60 * 1000).toISOString(),
      providerSpecificData: { refreshLeadMs: 60 * 60 * 1000 },
    };

    expect(selectConnectionsNeedingRefresh([connection], nowMs)).toEqual([connection]);
  });

  it("does not repeatedly refresh a newly issued short-lived token", () => {
    const nowMs = Date.now();
    const credentials = {
      provider: "grok-cli",
      authType: "oauth",
      refreshToken: "refresh-token",
      lastRefreshAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 45 * 60 * 1000).toISOString(),
      providerSpecificData: { refreshLeadMs: 60 * 60 * 1000 },
    };

    expect(getEffectiveRefreshLeadMs("grok-cli", credentials, nowMs)).toBe(22.5 * 60 * 1000);
    expect(shouldRefreshCredentials("grok-cli", credentials, nowMs)).toBe(false);
    expect(selectConnectionsNeedingRefresh([credentials], nowMs)).toEqual([]);
  });

  it("rejects invalid override values and keeps the provider default", () => {
    expect(getRefreshLeadMs("grok-cli", { refreshLeadMs: MAX_CONNECTION_REFRESH_LEAD_MS })).toBe(
      MAX_CONNECTION_REFRESH_LEAD_MS
    );
    expect(getRefreshLeadMs("grok-cli", { refreshLeadMs: Infinity })).toBe(5 * 60 * 1000);
    expect(getRefreshLeadMs("grok-cli", { refreshLeadMs: Number.MAX_VALUE })).toBe(5 * 60 * 1000);
    expect(getRefreshLeadMs("grok-cli", { refreshLeadMs: MAX_CONNECTION_REFRESH_LEAD_MS + 1 })).toBe(
      5 * 60 * 1000
    );
    expect(getRefreshLeadMs("grok-cli", { refreshLeadMs: "3600000" })).toBe(5 * 60 * 1000);
    expect(getRefreshLeadMs("grok-cli", { refreshLeadMs: 0 })).toBe(5 * 60 * 1000);
  });
});
