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

let mounted;

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mountSidebar() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn((url) => Promise.resolve(new Response(JSON.stringify(
    String(url) === "/api/settings"
      ? { enableTranslator: false, hiddenNavItems: [] }
      : { currentVersion: "0.0.1", latestVersion: null, hasUpdate: false, isTrayMode: false },
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

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sidebar build footer", () => {
  it("renders the baked build sha when present", async () => {
    vi.stubEnv("NEXT_PUBLIC_TP_BUILD_SHA", "deadbee12345");

    const { container } = await mountSidebar();

    const footer = container.querySelector('[data-testid="sidebar-build"]');
    expect(footer).not.toBeNull();
    expect(footer.textContent).toContain("build deadbee12345");
  });

  it("renders nothing when the build sha is absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_TP_BUILD_SHA", "");

    const { container } = await mountSidebar();

    expect(container.querySelector('[data-testid="sidebar-build"]')).toBeNull();
  });

  it("renders nothing when the build sha is unknown", async () => {
    vi.stubEnv("NEXT_PUBLIC_TP_BUILD_SHA", "unknown");

    const { container } = await mountSidebar();

    expect(container.querySelector('[data-testid="sidebar-build"]')).toBeNull();
  });
});
