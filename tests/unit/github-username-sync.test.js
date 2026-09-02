import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ConnectionRow from "@/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js";

const noop = () => {};
const originalDataDir = process.env.DATA_DIR;
const proxyAwareFetch = vi.hoisted(() => vi.fn());
const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

let dataDir;
let listenerBaseline;
let models;
let syncUsername;

async function createConnection(overrides = {}) {
  return models.createProviderConnection({
    provider: "github",
    authType: "oauth",
    name: "Before sync",
    displayName: "Existing display name",
    email: "existing@example.test",
    accessToken: "test-access-token",
    scope: "read:user",
    providerSpecificData: { preserve: "existing value" },
    ...overrides,
  });
}

async function post(connection) {
  return syncUsername(new Request("http://localhost/api/providers/sync-username", { method: "POST" }), {
    params: Promise.resolve({ id: connection.id }),
  });
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "tokenproxy-github-username-"));
  listenerBaseline = Object.fromEntries(
    signals.map((signal) => [signal, process.listeners(signal).slice()]),
  );
  process.env.DATA_DIR = dataDir;
  delete global._dbAdapter;
  vi.resetModules();
  proxyAwareFetch.mockReset();
  models = await import("@/models/index.js");
  ({ POST: syncUsername } = await import("@/app/api/providers/[id]/sync-username/route.js"));
});

afterEach(() => {
  try {
    global._dbAdapter?.instance?.close?.();
  } finally {
    delete global._dbAdapter;
    for (const signal of signals) {
      for (const listener of process.listeners(signal)) {
        if (!listenerBaseline[signal].includes(listener)) {
          process.removeListener(signal, listener);
        }
      }
    }
    vi.resetModules();
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});

function renderRow(provider) {
  return renderToStaticMarkup(createElement(ConnectionRow, {
    connection: {
      id: `${provider}-connection`,
      provider,
      name: "Connected account",
      priority: 1,
      isActive: true,
      providerSpecificData: {},
    },
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

describe("GitHub username sync row control", () => {
  it("offers the manual refresh control only for GitHub connections", () => {
    expect(renderRow("github")).toContain("Sync username");
    expect(renderRow("codex")).not.toContain("Sync username");
  });
});

describe("GitHub username sync route", () => {
  it("atomically merges a name and provider-data patch with the current connection state", async () => {
    const connection = await createConnection();
    await models.updateProviderConnection(connection.id, {
      providerSpecificData: {
        ...connection.providerSpecificData,
        proxyPoolId: "rebound-pool",
        strictProxy: true,
      },
    });

    const updated = await models.mergeProviderConnectionData(connection.id, {
      name: "octocat",
      providerSpecificData: { githubLogin: "octocat" },
    });

    expect(updated).toMatchObject({
      name: "octocat",
      providerSpecificData: {
        preserve: "existing value",
        proxyPoolId: "rebound-pool",
        strictProxy: true,
        githubLogin: "octocat",
      },
    });
  });

  it("returns 404 before any egress for an unknown connection", async () => {
    const response = await syncUsername(new Request("http://localhost/api/providers/sync-username", { method: "POST" }), {
      params: Promise.resolve({ id: "missing-connection" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Connection not found" });
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("uses the configured GitHub identity endpoint, persists only the login identity, and returns no profile", async () => {
    const connection = await createConnection();
    proxyAwareFetch.mockResolvedValue(new Response(JSON.stringify({
      login: "octocat",
      name: "Profile name that must not persist",
      email: "profile@example.test",
    }), { status: 200 }));

    const response = await post(connection);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ username: "octocat" });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, options, proxyOptions] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.github.com/user");
    expect(options.method).toBe("GET");
    expect(options.headers).toMatchObject({
      Authorization: "Bearer test-access-token",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "GitHubCopilotChat/0.26.7",
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(proxyOptions).toMatchObject({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
    });

    expect(await models.getProviderConnectionById(connection.id)).toMatchObject({
      name: "octocat",
      displayName: "Existing display name",
      email: "existing@example.test",
      providerSpecificData: {
        preserve: "existing value",
        githubLogin: "octocat",
      },
    });
  });

  it("merges the GitHub login with proxy data updated while the profile request was in flight", async () => {
    const connection = await createConnection();
    proxyAwareFetch.mockImplementation(async () => {
      const current = await models.getProviderConnectionById(connection.id);
      await models.updateProviderConnection(connection.id, {
        providerSpecificData: {
          ...current.providerSpecificData,
          proxyPoolId: "rebound-pool",
          strictProxy: true,
        },
      });
      return new Response(JSON.stringify({ login: "octocat" }), { status: 200 });
    });

    const response = await post(connection);

    expect(response.status).toBe(200);
    expect((await models.getProviderConnectionById(connection.id)).providerSpecificData).toEqual({
      preserve: "existing value",
      proxyPoolId: "rebound-pool",
      strictProxy: true,
      githubLogin: "octocat",
    });
  });

  it("rejects a non-GitHub connection before any egress", async () => {
    const connection = await createConnection({ provider: "codex" });

    const response = await post(connection);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Username sync is only available for GitHub connections" });
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("rejects a missing token before any egress", async () => {
    const connection = await createConnection({ accessToken: undefined });

    const response = await post(connection);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "GitHub authorization is unavailable" });
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("fails closed when a strict selected proxy is unavailable", async () => {
    const connection = await createConnection({
      providerSpecificData: { proxyPoolId: "missing-pool", strictProxy: true },
    });

    const response = await post(connection);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Required proxy is unavailable" });
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("returns the same safe authorization response for an upstream 401", async () => {
    const connection = await createConnection();
    proxyAwareFetch.mockResolvedValue(new Response("expired token", { status: 401 }));

    const response = await post(connection);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "GitHub authorization is unavailable" });
    expect((await models.getProviderConnectionById(connection.id)).name).toBe("Before sync");
  });

  it("does not expose non-401 upstream failures", async () => {
    const connection = await createConnection();
    proxyAwareFetch.mockResolvedValue(new Response("upstream diagnostic", { status: 500 }));

    const response = await post(connection);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Unable to sync GitHub username" });
    expect((await models.getProviderConnectionById(connection.id)).name).toBe("Before sync");
  });
});
