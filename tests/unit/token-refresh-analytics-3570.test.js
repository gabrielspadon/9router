// The Usage menu shows what was spent but nothing about token rotation, so a
// user watching for a refresh has to reload the browser to learn anything
// (#3570). Every input already exists per connection; this derives a view.
import fs from "node:fs";
import { describe, it, expect } from "vitest";
import {
  describeRotation,
  rotates,
  summarizeTokenRotation,
} from "@/lib/tokenRefreshAnalytics.js";
import { getRefreshLeadMs, TOKEN_EXPIRY_BUFFER_MS } from "open-sse/services/tokenRefresh.js";

const NOW = Date.parse("2026-08-31T12:00:00.000Z");
const at = (offsetMs) => new Date(NOW + offsetMs).toISOString();
const MIN = 60_000;

const oauth = (over = {}) => ({
  id: "c1", provider: "codex", authType: "oauth", name: "work", ...over,
});

describe("only a connection with rotation state is reported", () => {
  it("an OAuth connection rotates even before its first refresh", () => {
    expect(rotates(oauth({ expiresAt: null, lastRefreshAt: null }))).toBe(true);
  });

  it("an API-key connection is left out rather than listed as unknown forever", () => {
    expect(rotates({ id: "k", provider: "glm", authType: "apikey" })).toBe(false);
    const out = summarizeTokenRotation([{ id: "k", provider: "glm", authType: "apikey" }], NOW);
    expect(out.connections).toEqual([]);
    expect(out.counts.tracked).toBe(0);
  });

  it("an API-key connection that does carry an expiry is still reported", () => {
    expect(rotates({ id: "k", provider: "kiro", authType: "api_key", expiresAt: at(MIN) })).toBe(true);
  });

  it("a missing or non-array input is an empty report, not a crash", () => {
    for (const bad of [null, undefined, "nope", 7]) {
      expect(summarizeTokenRotation(bad, NOW).connections).toEqual([]);
    }
  });
});

describe("the status matches what the router would actually do", () => {
  it("past its expiry is expired", () => {
    expect(describeRotation(oauth({ expiresAt: at(-1) }), NOW).status).toBe("expired");
  });

  it("inside the provider's own refresh lead is due", () => {
    const lead = getRefreshLeadMs("codex");
    expect(describeRotation(oauth({ expiresAt: at(lead - 1000) }), NOW).status).toBe("due");
  });

  it("outside it is fresh", () => {
    const lead = getRefreshLeadMs("codex");
    expect(describeRotation(oauth({ expiresAt: at(lead + 60 * MIN) }), NOW).status).toBe("fresh");
  });

  it("no expiry at all is unknown rather than assumed healthy", () => {
    expect(describeRotation(oauth({ lastRefreshAt: at(-MIN) }), NOW).status).toBe("unknown");
  });

  it("the threshold is the provider's, not a number invented here", () => {
    const row = describeRotation(oauth({ expiresAt: at(60 * MIN) }), NOW);
    expect(row.refreshLeadMs).toBe(getRefreshLeadMs("codex"));
    // A per-connection override is honoured the same way the router honours it.
    const overridden = describeRotation(
      oauth({ expiresAt: at(60 * MIN), providerSpecificData: { refreshLeadMs: 90 * MIN } }),
      NOW,
    );
    expect(overridden.refreshLeadMs).toBe(90 * MIN);
    expect(overridden.status).toBe("due");
  });

  it("a provider with no entry of its own falls back to the shared buffer", () => {
    const row = describeRotation({ id: "x", provider: "not-a-real-provider", authType: "oauth", expiresAt: at(MIN) }, NOW);
    expect(row.refreshLeadMs).toBe(TOKEN_EXPIRY_BUFFER_MS);
  });
});

describe("the countdown is the thing that makes the card live", () => {
  it("time to expiry and time since refresh are relative to now", () => {
    const row = describeRotation(oauth({ expiresAt: at(10 * MIN), lastRefreshAt: at(-5 * MIN) }), NOW);
    expect(row.expiresInMs).toBe(10 * MIN);
    expect(row.sinceRefreshMs).toBe(5 * MIN);
  });

  it("an already-dead token reports a negative rather than a clamped zero", () => {
    expect(describeRotation(oauth({ expiresAt: at(-3 * MIN) }), NOW).expiresInMs).toBe(-3 * MIN);
  });

  it("an epoch-seconds expiry is read as seconds, not as 1970", () => {
    const secs = Math.floor((NOW + 10 * MIN) / 1000);
    expect(describeRotation(oauth({ expiresAt: secs }), NOW).expiresInMs).toBe(10 * MIN);
  });

  it("an epoch-milliseconds expiry is read as milliseconds", () => {
    expect(describeRotation(oauth({ expiresAt: NOW + 10 * MIN }), NOW).expiresInMs).toBe(10 * MIN);
  });

  it("an unparseable stamp is null, not NaN", () => {
    const row = describeRotation(oauth({ expiresAt: "whenever", lastRefreshAt: "" }), NOW);
    expect(row.expiresInMs).toBeNull();
    expect(row.sinceRefreshMs).toBeNull();
    expect(row.status).toBe("unknown");
  });
});

describe("the summary answers what the card shows at a glance", () => {
  // Far enough out that no provider's refresh lead reaches it.
  const FAR = getRefreshLeadMs("codex") + 60 * MIN;
  const connections = [
    oauth({ id: "fresh", expiresAt: at(FAR) }),
    oauth({ id: "due", expiresAt: at(1 * MIN) }),
    oauth({ id: "dead", expiresAt: at(-30 * MIN) }),
    oauth({ id: "silent" }),
    { id: "apikey-only", provider: "glm", authType: "apikey" },
  ];

  it("counts each status and how many are tracked at all", () => {
    const out = summarizeTokenRotation(connections, NOW);
    expect(out.counts).toEqual({ tracked: 4, fresh: 1, due: 1, expired: 1, unknown: 1 });
  });

  it("names the next rotation, skipping the ones already past it", () => {
    const out = summarizeTokenRotation(connections, NOW);
    expect(out.nextExpiryInMs).toBe(1 * MIN);
    expect(out.nextExpiryAt).toBe(at(1 * MIN));
  });

  it("orders by soonest expiry, with the ones that have none last", () => {
    const out = summarizeTokenRotation(connections, NOW);
    expect(out.connections.map((c) => c.id)).toEqual(["dead", "due", "fresh", "silent"]);
  });

  it("stamps when it was generated, so a stale poll is visible", () => {
    expect(summarizeTokenRotation(connections, NOW).generatedAt).toBe(at(0));
  });
});

describe("the report carries no credential", () => {
  const secretive = oauth({
    expiresAt: at(MIN),
    accessToken: "at-secret",
    refreshToken: "rt-secret",
    idToken: "id-secret",
    apiKey: "sk-secret",
    providerSpecificData: { copilotToken: "cp-secret" },
  });

  it("nothing from the connection's token material reaches the row", () => {
    const serialized = JSON.stringify(describeRotation(secretive, NOW));
    for (const secret of ["at-secret", "rt-secret", "id-secret", "sk-secret", "cp-secret"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("the row is a fixed whitelist, not the connection with fields deleted", () => {
    expect(Object.keys(describeRotation(secretive, NOW)).sort()).toEqual([
      "authType", "expiresAt", "expiresInMs", "id", "isActive", "lastRefreshAt",
      "name", "provider", "refreshLeadMs", "sinceRefreshMs", "status",
    ]);
  });
});

describe("the endpoint the card polls", () => {
  const route = fs.readFileSync(
    new URL("../../src/app/api/usage/token-refresh/route.js", import.meta.url), "utf8");

  it("reads persisted connections and returns the summary", () => {
    expect(route).toContain("getProviderConnections()");
    expect(route).toContain("summarizeTokenRotation(connections)");
  });

  it("is never cached, so polling it returns moving numbers", () => {
    expect(route).toContain('export const dynamic = "force-dynamic"');
    expect(route).toContain('"Cache-Control": "no-store"');
  });

  it("makes no provider call, so a poll costs one local read", () => {
    expect(route).not.toMatch(/fetch\(|getUsageForProvider|refreshAndUpdateCredentials/);
  });
});
