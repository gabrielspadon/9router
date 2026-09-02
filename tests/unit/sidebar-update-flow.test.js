// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, ...props }) => <a {...props}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

import Sidebar from "../../src/shared/components/Sidebar.js";

const INSTALL_CMD = "npm i -g tokenproxy@latest --prefer-online";
let mounted;
let clipboard;

function findButton(container, text) {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent.includes(text),
  );
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function click(button) {
  expect(button).toBeDefined();
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  await settle();
}

async function mountSidebar(isTrayMode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  clipboard = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
  vi.stubGlobal("fetch", vi.fn((url) => Promise.resolve(new Response(JSON.stringify(
    String(url) === "/api/settings"
      ? { enableTranslator: false, hiddenNavItems: [] }
      : {
          currentVersion: "1.0.0",
          latestVersion: "999.0.0",
          hasUpdate: true,
          isTrayMode,
        },
  ), { status: 200, headers: { "Content-Type": "application/json" } }))));

  await act(async () => {
    root.render(<Sidebar />);
  });
  mounted = {
    container,
    unmount: () => act(() => root.unmount()),
  };
  await settle();
  return mounted;
}

async function openManualUpdate(container) {
  await click(findButton(container, "Update now"));
  await click(findButton(container, "Show Command"));
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete navigator.clipboard;
});

describe("manual update relaunch flow", () => {
  it("copies the tray relaunch command only after Copy & Shutdown", async () => {
    const { container } = await mountSidebar(true);

    await openManualUpdate(container);
    await click(findButton(container, "Copy & Shutdown"));

    expect(clipboard).toHaveBeenLastCalledWith(`${INSTALL_CMD} && tokenproxy --tray`);
    expect(container.textContent).toContain("tokenproxy --tray");
  });

  it("keeps foreground Copy & Shutdown as an install-only command", async () => {
    const { container } = await mountSidebar(false);

    await openManualUpdate(container);
    await click(findButton(container, "Copy & Shutdown"));

    expect(clipboard).toHaveBeenLastCalledWith(INSTALL_CMD);
    expect(container.textContent).not.toContain(`${INSTALL_CMD} && tokenproxy`);
    expect(container.textContent).toContain("Run tokenproxy again after install.");
  });

  it("keeps the inline update copy as an install-only command", async () => {
    const { container } = await mountSidebar(true);

    await click(findButton(container, INSTALL_CMD));

    expect(clipboard).toHaveBeenLastCalledWith(INSTALL_CMD);
  });
});
