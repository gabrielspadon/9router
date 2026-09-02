// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, ...props }) => <a {...props}>{children}</a>,
}));

import CombosError from "../../src/app/(dashboard)/dashboard/combos/error.js";

let mounted;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

async function renderBoundary(error = new Error("render failed")) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const reset = vi.fn();

  await act(async () => {
    root.render(<CombosError error={error} reset={reset} />);
  });

  mounted = { container, unmount: () => act(() => root.unmount()) };
  return { container, reset };
}

describe("CombosError", () => {
  it("gives a failed combos render a dashboard escape route", async () => {
    const { container } = await renderBoundary();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The combos page failed to load",
    );
    expect(container.querySelector('a[href="/dashboard"]')?.textContent).toContain(
      "Back to Dashboard",
    );
  });

  it("retries a failed combos render through Next's reset callback", async () => {
    const { container, reset } = await renderBoundary();
    const retry = [...container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Try again"),
    );

    expect(retry).toBeDefined();

    await act(async () => {
      retry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(reset).toHaveBeenCalledOnce();
  });

  it("logs the failed combos render for diagnosis", async () => {
    const error = new Error("render failed");
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    await renderBoundary(error);

    expect(logError).toHaveBeenCalledWith("Combos page error:", error);
  });
});
