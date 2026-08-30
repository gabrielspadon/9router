import { describe, expect, it, vi } from "vitest";

const kimchiUa = vi.hoisted(() => ({ current: "kimchi/0.1.01" }));

vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => kimchiUa.current,
  updateKimchiUserAgent: async () => kimchiUa.current,
}));

import { getExecutor } from "../../open-sse/executors/index.js";

describe("Kimchi request headers", () => {
  it("uses the refreshed User-Agent on later requests through the production executor", () => {
    const executor = getExecutor("kimchi");
    const credentials = {
      accessToken: "tok-kimchi",
      providerSpecificData: {},
    };

    const initial = executor.buildHeaders(credentials, true);
    expect(initial["User-Agent"]).toBe("kimchi/0.1.01");

    kimchiUa.current = "kimchi/1.0.6";
    const refreshed = executor.buildHeaders(credentials, true);

    expect(refreshed).toMatchObject({
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: "Bearer tok-kimchi",
      "User-Agent": "kimchi/1.0.6",
    });
  });
});
