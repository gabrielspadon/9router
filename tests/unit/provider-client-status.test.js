// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getProviderConnections = vi.fn();

vi.mock("@/lib/localDb", () => ({ getProviderConnections }));
vi.mock("@/lib/oauth/providers", () => ({ backfillCodexEmails: vi.fn() }));

const { GET } = await import("@/app/api/providers/client/route.js");
const { default: ProviderLimits } = await import(
  "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js"
);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const connection = (id, lockUntil) => ({
  id,
  provider: "kiro",
  authType: "api_key",
  name: `Kiro ${id}`,
  isActive: true,
  testStatus: "unavailable",
  ...(lockUntil && { "modelLock_claude-opus-5": lockUntil }),
});

async function getClientConnections(connections) {
  getProviderConnections.mockResolvedValue(connections);
  const response = await GET(new Request("http://localhost/api/providers/client?provider=kiro"));
  return response.json();
}

async function mounted(element) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(element);
    await Promise.resolve();
  });
  return { host, root };
}

describe("provider client effective status", () => {
  beforeEach(() => {
    getProviderConnections.mockReset();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("projects an expired model cooldown as recovering without exposing the lock", async () => {
    const { connections } = await getClientConnections([
      connection("expired", "2000-01-01T00:00:00Z"),
    ]);

    expect(connections[0]).toMatchObject({
      testStatus: "unavailable",
      effectiveStatus: "recovering",
    });
    expect(connections[0]).not.toHaveProperty("modelLock_claude-opus-5");
  });

  it("does not project recovery while a lock is live or when no expired lock exists", async () => {
    const { connections } = await getClientConnections([
      connection("live", "2999-01-01T00:00:00Z"),
      connection("no-lock"),
      { ...connection("failed", "2000-01-01T00:00:00Z"), testStatus: "error" },
      { ...connection("disabled", "2000-01-01T00:00:00Z"), isActive: false },
    ]);
    const byId = Object.fromEntries(connections.map((item) => [item.id, item]));

    expect(byId.live).not.toHaveProperty("effectiveStatus");
    expect(byId["no-lock"]).not.toHaveProperty("effectiveStatus");
    expect(byId.failed).not.toHaveProperty("effectiveStatus");
    expect(byId.disabled).not.toHaveProperty("effectiveStatus");
  });

  it("uses the public recovery projection in the Usage card", async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/api/providers/client")) {
        return {
          ok: true,
          json: async () => ({
            connections: [{ ...connection("usage"), effectiveStatus: "recovering" }],
            pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
            totals: { eligibleConnections: 1, providerFilteredConnections: 1 },
            providerOptions: ["kiro"],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { host, root } = await mounted(createElement(ProviderLimits));
    expect(host.textContent).toContain("recovering");
    expect(host.textContent).not.toContain("unavailable");

    await act(async () => root.unmount());
  });
});
