// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import MultiSelect from "../../src/shared/components/MultiSelect.js";

let root;

afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("MultiSelect all-items sentinel", () => {
  it("exposes the empty-value All providers control as pressed", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root.render(
        <MultiSelect
          label="Providers"
          allLabel="All providers"
          options={[
            { value: "openai", label: "OpenAI" },
            { value: "anthropic", label: "Anthropic" },
          ]}
          value={[]}
          onChange={vi.fn()}
        />,
      );
    });

    await act(async () => {
      host.querySelector("button").click();
    });

    const allProviders = [...host.querySelectorAll("button[aria-pressed]")]
      .find((button) => button.textContent.includes("All providers"));
    expect(allProviders).toBeTruthy();
    expect(allProviders.getAttribute("aria-pressed")).toBe("true");
  });
});
