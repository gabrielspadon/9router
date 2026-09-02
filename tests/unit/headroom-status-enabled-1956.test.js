import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const getSettings = vi.fn();
const getHeadroomStatus = vi.fn();

vi.mock("@/lib/localDb", () => ({ getSettings: (...a) => getSettings(...a) }));
vi.mock("@/lib/headroom/detect", () => ({
  DEFAULT_HEADROOM_URL: "http://127.0.0.1:8099",
  getHeadroomStatus: (...a) => getHeadroomStatus(...a),
}));
vi.mock("@/lib/headroom/process", () => ({ getManagedPid: () => null }));

const { GET } = await import("@/app/api/headroom/status/route.js");

beforeEach(() => {
  getSettings.mockReset();
  getHeadroomStatus.mockReset().mockResolvedValue({ installed: true, running: true });
});

describe("headroom status reports the toggle, not only the probe (#1956)", () => {
  it("a reachable proxy with the toggle off is not active", async () => {
    getSettings.mockResolvedValue({ headroomEnabled: false });
    const body = await (await GET()).json();
    // This is the reported state: the dashboard said Running and nothing was
    // ever compressed.
    expect(body.running).toBe(true);
    expect(body.enabled).toBe(false);
    expect(body.active).toBe(false);
  });

  it("is active only when the toggle is on and the proxy answers", async () => {
    getSettings.mockResolvedValue({ headroomEnabled: true });
    expect((await (await GET()).json()).active).toBe(true);
  });

  it("is not active when the toggle is on but the proxy is down", async () => {
    getSettings.mockResolvedValue({ headroomEnabled: true });
    getHeadroomStatus.mockResolvedValue({ installed: true, running: false });
    expect((await (await GET()).json()).active).toBe(false);
  });

  it("treats a missing setting as off rather than as on", async () => {
    getSettings.mockResolvedValue({});
    expect((await (await GET()).json()).enabled).toBe(false);
  });
});

describe("the handler says why it skipped compression (#1956)", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const core = readFileSync(join(root, "open-sse/handlers/chatCore.js"), "utf8");

  it("warns when the saver is on regardless of the headroom toggle", () => {
    expect(core).toContain("} else if (tokenSaverEnabled)");
    expect(core).toContain('"disabled in settings"');
  });
});
