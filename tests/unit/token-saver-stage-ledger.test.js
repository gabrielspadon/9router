// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TokenSaverClient from "../../src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js";

let mounted;

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const STATS_WITH_STAGES = {
  windows: {
    today: {
      charsReduced: 0,
      proxyTokensSaved: 0,
      bodyBytesReduced: 0,
      stages: {
        rtk: { bytesSaved: -13201, count: 13 },
        inject: { bytesSaved: 3952, count: 1 },
      },
    },
  },
};

function stubFetch(statsBody, statsStatus = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url, opts) => {
      if (String(url) === "/api/token-saver/stats" && (!opts || opts.method !== "PATCH")) {
        return Promise.resolve(
          new Response(JSON.stringify(statsBody), {
            status: statsStatus,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
}

async function mountClient(statsBody, statsStatus = 200) {
  stubFetch(statsBody, statsStatus);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<TokenSaverClient />);
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

afterEach(async () => {
  if (mounted) {
    await mounted.unmount();
  }
  mounted = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("token-saver per-stage savings ledger", () => {
  it("renders one row per stage present in windows.today.stages", async () => {
    const { container } = await mountClient(STATS_WITH_STAGES);

    const card = container.querySelector("#stage-savings");
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("Per-stage savings (today)");

    const rows = [...card.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(2);

    const rtkRow = rows.find((r) => r.textContent.includes("RTK"));
    expect(rtkRow).toBeDefined();
    expect(rtkRow.textContent).toContain("-12.9 KB"); // savings, one-decimal KB
    expect(rtkRow.textContent).toContain("13");

    const injectRow = rows.find((r) => r.textContent.includes("Prompt inject"));
    expect(injectRow).toBeDefined();
    expect(injectRow.textContent).toContain("+3,952");
    expect(injectRow.textContent).toContain("1");
    // growth (positive bytesSaved) is the anomalous state and is flagged
    expect(injectRow.querySelector(".text-warning")).not.toBeNull();
    expect(rtkRow.querySelector(".text-warning")).toBeNull();
  });

  it("shows the empty message when stages are absent", async () => {
    const { container } = await mountClient({ windows: { today: {} } });

    const card = container.querySelector("#stage-savings");
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("No saver activity yet today.");
  });

  it("shows the unavailable message when the stats fetch fails", async () => {
    const { container } = await mountClient({}, 500);

    const card = container.querySelector("#stage-savings");
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("Statistics unavailable");
  });
});
