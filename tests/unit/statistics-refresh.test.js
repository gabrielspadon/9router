// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("recharts", () => ({
  Area: () => null,
  AreaChart: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
  ResponsiveContainer: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const StatisticsContent = (
  await import("@/app/(dashboard)/dashboard/statistics/StatisticsContent.js")
).default;

const initialData = {
  filters: { providers: [], accounts: [], models: [] },
  summary: {
    totalRequests: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    cacheHitRate: null,
    latency: { avgLatencyMs: null, avgTtftMs: null, latencySamples: 0, ttftSamples: 0, requests: 0 },
  },
  series: [],
  items: [],
  pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0 },
};

describe("StatisticsContent refresh", () => {
  let host;
  let root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => initialData }));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("keeps the server-rendered payload until the operator requests a refresh", async () => {
    await act(async () => {
      root.render(<StatisticsContent initialData={initialData} />);
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();

    const refresh = [...host.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Refresh statistics");
    expect(refresh).toBeTruthy();

    await act(async () => {
      refresh.click();
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts an in-flight statistics request when the view unmounts", async () => {
    let signal;
    globalThis.fetch = vi.fn((_url, options) => {
      signal = options?.signal;
      return new Promise(() => {});
    });

    await act(async () => {
      root.render(<StatisticsContent initialData={initialData} />);
    });
    expect(signal).toBeUndefined();

    const refresh = [...host.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Refresh statistics");
    await act(async () => {
      refresh.click();
    });
    expect(signal).toBeInstanceOf(AbortSignal);

    await act(async () => root.unmount());
    expect(signal.aborted).toBe(true);
    root = createRoot(host);
  });
});
