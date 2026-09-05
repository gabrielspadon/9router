// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HeaderMenu from "../../src/shared/components/HeaderMenu.js";

let mounted;

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function mountHeaderMenu() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<HeaderMenu onLogout={() => {}} />);
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
  // useTheme reads the system colour scheme; jsdom ships no matchMedia.
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });
});

afterEach(async () => {
  if (mounted) {
    await mounted.unmount();
  }
  mounted = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("header build badge", () => {
  it("renders the baked build sha when present", async () => {
    vi.stubEnv("NEXT_PUBLIC_TP_BUILD_SHA", "deadbee12345");

    const { container } = await mountHeaderMenu();

    const badge = container.querySelector('[data-testid="header-build"]');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain("build deadbee12345");
    expect(badge.className).toContain("font-mono");
  });

  it("renders nothing when the build sha is absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_TP_BUILD_SHA", "");

    const { container } = await mountHeaderMenu();

    expect(container.querySelector('[data-testid="header-build"]')).toBeNull();
  });

  it("renders nothing when the build sha is unknown", async () => {
    vi.stubEnv("NEXT_PUBLIC_TP_BUILD_SHA", "unknown");

    const { container } = await mountHeaderMenu();

    expect(container.querySelector('[data-testid="header-build"]')).toBeNull();
  });
});
