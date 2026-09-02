// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/components", () => ({
  Button: ({ children, icon: _icon, size: _size, variant: _variant, ...props }) => (
    <button {...props}>{children}</button>
  ),
}));

import CompatibleModelsSection from "@/app/(dashboard)/dashboard/providers/[id]/CompatibleModelsSection.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const baseProps = {
  providerStorageAlias: "openai-compatible-chat-11111111",
  providerDisplayAlias: "local",
  modelAliases: {},
  customModels: [],
  copied: "",
  onCopy: vi.fn(),
  onDeleteAlias: vi.fn(),
  onAddCustomModel: vi.fn(),
  onDeleteCustomModel: vi.fn(),
  connections: [{ id: "connection-1", isActive: true }],
  isAnthropic: false,
};

let container;
let root;

function findButton(text) {
  return [...container.querySelectorAll("button")].find((button) => button.textContent.includes(text));
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function importModels() {
  const button = findButton("Import from /models");
  expect(button).toBeDefined();
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  await settle();
}

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("alert", vi.fn());
  await act(async () => root.render(<CompatibleModelsSection {...baseProps} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("compatible model catalog import failures", () => {
  it("renders the API catalog message and recovery action instead of opening an alert", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "Failed to fetch models: 401",
      catalog: {
        state: "unauthorized",
        code: "provider_catalog_unauthorized",
        retryable: false,
        message: "The provider rejected the model catalog credentials.",
        action: "Update the connection credentials, then retry the import.",
      },
    }), { status: 401, headers: { "Content-Type": "application/json" } })));

    await importModels();

    const catalogAlert = container.querySelector('[role="alert"]');
    expect(catalogAlert?.textContent).toContain("The provider rejected the model catalog credentials.");
    expect(catalogAlert?.textContent).toContain("Update the connection credentials, then retry the import.");
    expect(globalThis.alert).not.toHaveBeenCalled();
  });

  it("renders a retry action when the catalog request cannot reach tokenproxy", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await importModels();

    const catalogAlert = container.querySelector('[role="alert"]');
    expect(catalogAlert?.textContent).toContain("Could not reach the model catalog.");
    expect(findButton("Retry import")).toBeDefined();
    expect(log.mock.calls).not.toContainEqual([
      "Error importing models:",
      expect.any(TypeError),
    ]);
    log.mockRestore();
  });
});
