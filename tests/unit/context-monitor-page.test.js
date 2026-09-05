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
              sid: "a1b2c3d4",
              rid: "9f8e7d6c",
              ctxTokens: 184000,
              saveBytes: -2048,
              ceBytes: 4096,
              compactHint: true,
              updatedAt: "2026-09-05T12:00:00Z",
            },
            {
              sid: "c3d4e5f6",
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
    expect(container.textContent).toContain("a1b2c3d4");
    expect(container.textContent).toContain("9f8e7d6c");
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
              sid: "e5f60718",
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
    expect(container.textContent).toContain("e5f60718");
  });
});

describe("ContextMonitorClient polling discipline", () => {
  async function mountWith(fetchImpl) {
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
    return mounted;
  }

  it("backs off 5s -> 10s -> 20s after consecutive failures, then resets on success", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fetchMock = vi.fn(() => {
        calls++;
        // fourth call recovers
        return Promise.resolve(
          calls < 4 ? ok({ error: "down" }, 503) : ok({ generatedAt: "2026-09-05T12:00:00Z", entries: [] }),
        );
      });
      await mountWith(fetchMock);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(fetchMock).toHaveBeenCalledTimes(1); // t=0 immediate poll, fails

      // first backoff step is 10s: nothing at +5s
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(fetchMock).toHaveBeenCalledTimes(2); // t=10s, fails

      // second backoff step is 20s
      await act(async () => { await vi.advanceTimersByTimeAsync(19000); });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(fetchMock).toHaveBeenCalledTimes(3); // t=30s, fails

      // third failure backs off 40s: call 4 lands at t=70s and succeeds
      await act(async () => { await vi.advanceTimersByTimeAsync(39000); });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(fetchMock).toHaveBeenCalledTimes(4); // t=70s, recovers

      // success resets to the 5s base interval
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(fetchMock).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("every poll fetch carries an AbortSignal.timeout signal", async () => {
    vi.useFakeTimers();
    try {
      let capturedSignal = null;
      await mountWith((_url, opts) => {
        capturedSignal = opts?.signal;
        return Promise.resolve(ok({ generatedAt: "2026-09-05T12:00:00Z", entries: [] }));
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(capturedSignal).toBeInstanceOf(AbortSignal);
      expect(capturedSignal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a hung request cannot overlap the next poll tick", async () => {
    vi.useFakeTimers();
    try {
      let resolveFirst = null;
      let call = 0;
      const fetchMock = vi.fn(() => {
        call++;
        if (call === 1) return new Promise((res) => { resolveFirst = res; });
        return Promise.resolve(ok({ generatedAt: "2026-09-05T12:00:00Z", entries: [] }));
      });
      await mountWith(fetchMock);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // advance well past two poll intervals while the first fetch hangs:
      // the in-flight guard must suppress further fetches
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // let the hung request finish: the chain resumes from the next tick
      await act(async () => {
        resolveFirst(ok({ generatedAt: "2026-09-05T12:00:00Z", entries: [] }));
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
