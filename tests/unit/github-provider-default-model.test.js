// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import BasicChatPageClient from "../../src/app/(dashboard)/dashboard/basic-chat/BasicChatPageClient.js";

import {
  getDefaultModel,
  getModelsByProviderId,
} from "../../open-sse/config/providerModels.js";

describe("GitHub Copilot free-tier default model", () => {
  it("selects GoldenEye Auto first through the registry-derived model path", () => {
    expect(getModelsByProviderId("github")[0]).toMatchObject({
      id: "goldeneye-free-auto",
      name: "GoldenEye (Auto)",
    });
    expect(getDefaultModel("gh")).toBe("goldeneye-free-auto");
  });
});

let mountedRoot = null;

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
}

async function renderBasicChat({
  liveModels = [],
  provider = "github",
  providerName = "GitHub Copilot",
  catalog = null,
} = {}) {
  vi.stubGlobal("localStorage", createStorage());
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn((url) => {
    if (url === "/api/providers") {
      return Promise.resolve(new Response(JSON.stringify({
        connections: [{
          id: "github-connection",
          provider,
          name: providerName,
          isActive: true,
        }],
      }), { status: 200 }));
    }
    if (url === "/api/providers/github-connection/models") {
      return Promise.resolve(new Response(JSON.stringify({ models: liveModels, ...(catalog ? { catalog } : {}) }), { status: 200 }));
    }
    throw new Error(`Unexpected request: ${url}`);
  }));

  const container = document.createElement("div");
  document.body.appendChild(container);
  mountedRoot = createRoot(container);
  await act(async () => {
    mountedRoot.render(<BasicChatPageClient />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

afterEach(() => {
  if (mountedRoot) {
    act(() => mountedRoot.unmount());
    mountedRoot = null;
  }
  document.body.innerHTML = "";
  globalThis.localStorage?.clear?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Basic Chat Copilot default", () => {
  it("uses GoldenEye Auto when no model has been selected", async () => {
    const container = await renderBasicChat();
    const modelButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.includes("github/"));

    expect(modelButton?.textContent).toContain("GoldenEye (Auto)");
    expect(modelButton?.textContent).toContain("github/goldeneye-free-auto");
    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      "/api/providers/github-connection/models",
      expect.anything(),
    );
  });

  it("refreshes a static catalog only after the operator asks", async () => {
    const container = await renderBasicChat({
      liveModels: [{ id: "github-live-model", name: "GitHub Live Model" }],
    });
    const modelButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.includes("github/"));

    await act(async () => {
      modelButton.click();
    });
    const refreshButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Refresh models"));

    expect(refreshButton).toBeTruthy();
    await act(async () => {
      refreshButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/providers/github-connection/models",
      { cache: "no-store" },
    );
    expect(container.textContent).toContain("GitHub Live Model");
  });

  it("waits for an operator refresh before querying an unavailable dynamic catalog", async () => {
    const container = await renderBasicChat({
      provider: "custom-unavailable",
      providerName: "Local coding endpoint",
      catalog: {
        state: "unavailable",
        code: "provider_catalog_unavailable",
        retryable: true,
        message: "Could not reach the provider model catalog. Check the connection endpoint, then refresh models.",
      },
    });

    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      "/api/providers/github-connection/models",
      expect.anything(),
    );
    expect(container.textContent).toContain("Providers connected but no models available.");

    const modelButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Select model"));
    await act(async () => {
      modelButton.click();
    });

    const refreshButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Refresh models"));
    expect(refreshButton).toBeTruthy();
    await act(async () => {
      refreshButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Local coding endpoint catalog is unavailable.");
    expect(container.textContent).toContain("Check the connection endpoint, then refresh models.");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/providers/github-connection/models",
      { cache: "no-store" },
    );
  });
});
