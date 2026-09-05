import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const httpMocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("https", () => ({
  default: { get: httpMocks.get },
  get: httpMocks.get,
}));

import { GET } from "../../src/app/api/version/route.js";

function stubLatestVersion(version = "999.0.0") {
  httpMocks.get.mockImplementation((_url, _options, onResponse) => {
    const listeners = new Map();
    const response = {
      on(event, listener) {
        listeners.set(event, listener);
        return response;
      },
    };
    onResponse(response);
    queueMicrotask(() => {
      listeners.get("data")?.(JSON.stringify({ version }));
      listeners.get("end")?.();
    });
    return { on: vi.fn(), destroy: vi.fn() };
  });
}

beforeEach(() => {
  httpMocks.get.mockReset();
  stubLatestVersion();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("version route build sha", () => {
  it("carries buildSha from TP_BUILD_SHA in the registry-lookup branch", async () => {
    vi.stubEnv("TP_BUILD_SHA", "deadbee12345");

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      buildSha: "deadbee12345",
      hasUpdate: true,
    });
  });

  it("carries buildSha in the opt-out branch (TOKENPROXY_NO_UPDATE)", async () => {
    vi.stubEnv("TP_BUILD_SHA", "deadbee12345");
    vi.stubEnv("TOKENPROXY_NO_UPDATE", "1");

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      buildSha: "deadbee12345",
      hasUpdate: false,
      latestVersion: null,
    });
    // Opted-out installs must not phone home.
    expect(httpMocks.get).not.toHaveBeenCalled();
  });

  it("reports null buildSha when the env value is empty", async () => {
    vi.stubEnv("TP_BUILD_SHA", "");

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({ buildSha: null });
  });
});
