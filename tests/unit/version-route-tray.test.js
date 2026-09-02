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

describe("version route tray mode", () => {
  it.each([
    [true, "1"],
    [false, "true"],
  ])("reports isTrayMode=%s for TRAY_MODE=%s", async (expected, trayMode) => {
    vi.stubEnv("TRAY_MODE", trayMode);

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      hasUpdate: true,
      isTrayMode: expected,
    });
  });
});
