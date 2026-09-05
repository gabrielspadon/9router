// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, ...props }) => <a {...props}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/context",
}));

import ContextMonitorClient from "../../src/app/(dashboard)/dashboard/context/ContextMonitorClient.js";

let mounted;

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mountClient(fetchImpl) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(fetchImpl));

  await act(async () => {
    root.render(<ContextMonitorClient />);
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

const ok = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("ContextMonitorClient", () => {
  it("renders rows with formatted telemetry", async () => {
    const { container } = await mountClient(() =>
      Promise.resolve(
        ok({
          generatedAt: "2026-09-05T12:00:00Z",
          entries: [
            {
              sid: "sess-a1b2",
              rid: "req-9",
              ctxTokens: 184000,
              saveBytes: -2048,
              ceBytes: 4096,
              compactHint: true,
              updatedAt: "2026-09-05T12:00:00Z",
            },
            {
              sid: "sess-c3d4",
              rid: null,
              ctxTokens: null,
              saveBytes: 512,
              ceBytes: null,
              compactHint: false,
              updatedAt: "2026-09-05T11:59:30Z",
            },
          ],
        }),
      ),
    );

    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2);
    expect(container.textContent).toContain("sess-a1b2");
    expect(container.textContent).toContain("req-9");
    expect(container.textContent).toContain("184,000");
    expect(container.textContent).toContain("\u22122.0 KB");
    expect(container.textContent).toContain("+512 B");
    expect(container.textContent).toContain("compact");
  });

  it("renders the empty state when there is no telemetry", async () => {
    const { container } = await mountClient(() =>
      Promise.resolve(ok({ generatedAt: "2026-09-05T12:00:00Z", entries: [] })),
    );

    expect(container.querySelectorAll("tbody tr").length).toBe(0);
    expect(container.textContent).toContain(
      "No session telemetry yet. Telemetry appears after the first chat request of a session.",
    );
  });

  it("renders the unavailable state with a retry on 503", async () => {
    const { container } = await mountClient(() =>
      Promise.resolve(ok({ error: "telemetry unavailable" }, 503)),
    );

    expect(container.textContent).toContain("unavailable");
    const retry = container.querySelector("button");
    expect(retry).not.toBeNull();

    // A successful retry recovers the table.
    globalThis.fetch.mockImplementation(() =>
      Promise.resolve(
        ok({
          generatedAt: "2026-09-05T12:00:00Z",
          entries: [
            {
              sid: "sess-e5f6",
              rid: null,
              ctxTokens: 42,
              saveBytes: 0,
              ceBytes: 1024,
              compactHint: false,
              updatedAt: "2026-09-05T12:00:00Z",
            },
          ],
        }),
      ),
    );
    await act(async () => {
      retry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(container.querySelectorAll("tbody tr").length).toBe(1);
    expect(container.textContent).toContain("sess-e5f6");
  });
});
