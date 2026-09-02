// Issue #930: usage already answers how much a key spent; it could not answer
// how many things were spending it, which is what makes a leaked or shared key
// visible before the bill does.
import { describe, expect, it, vi, beforeEach } from "vitest";

let trustedPeer = true;
vi.mock("@/lib/auth/loginLimiter.js", () => ({
  // The real getClientIp trusts x-tp-real-ip only when custom-server proves it
  // stamped it from the socket, and falls back to a single bucket otherwise.
  getClientIp: (request) => {
    if (trustedPeer) return request.headers.get("x-tp-real-ip") || "unknown";
    return "unknown";
  },
}));

const {
  recordApiKeyDevice, getApiKeyDeviceCount, getApiKeyDeviceCounts, __resetApiKeyDevices,
} = await import("@/sse/services/apiKeyDevices.js");

const req = (ip, ua = "curl/8") => ({
  headers: new Map([["x-tp-real-ip", ip], ["user-agent", ua]]),
});
// Map has .get, which is the only header method the tracker uses.

beforeEach(() => {
  trustedPeer = true;
  __resetApiKeyDevices();
  vi.useRealTimers();
});

describe("what counts as one client (#930)", () => {
  it("counts the same address and agent once, however often it calls", () => {
    for (let i = 0; i < 5; i++) recordApiKeyDevice("k1", req("203.0.113.7"));
    expect(getApiKeyDeviceCount("k1")).toBe(1);
  });

  it("counts two addresses as two clients", () => {
    recordApiKeyDevice("k1", req("203.0.113.7"));
    recordApiKeyDevice("k1", req("203.0.113.8"));
    expect(getApiKeyDeviceCount("k1")).toBe(2);
  });

  it("counts two agents from one address as two clients", () => {
    recordApiKeyDevice("k1", req("203.0.113.7", "curl/8"));
    recordApiKeyDevice("k1", req("203.0.113.7", "python-requests/2"));
    expect(getApiKeyDeviceCount("k1")).toBe(2);
  });

  it("keeps keys apart", () => {
    recordApiKeyDevice("k1", req("203.0.113.7"));
    recordApiKeyDevice("k2", req("203.0.113.8"));
    expect(getApiKeyDeviceCount("k1")).toBe(1);
    expect(getApiKeyDeviceCount("k2")).toBe(1);
  });

  it("reports 0 for a key nothing has used", () => {
    expect(getApiKeyDeviceCount("never-seen")).toBe(0);
  });
});

describe("what it refuses to trust (#930)", () => {
  it("collapses to one bucket when the address cannot be trusted", () => {
    // The report proposed reading x-forwarded-for, which custom-server deletes
    // precisely because a client can set it. Without a trusted address there is
    // one bucket, so a client cannot inflate its own count by rotating a header.
    trustedPeer = false;
    recordApiKeyDevice("k1", req("1.1.1.1"));
    recordApiKeyDevice("k1", req("2.2.2.2"));
    recordApiKeyDevice("k1", req("3.3.3.3"));
    expect(getApiKeyDeviceCount("k1")).toBe(1);
  });

  it("stores no address, only a hash", () => {
    recordApiKeyDevice("k1", req("203.0.113.7"));
    const counts = getApiKeyDeviceCounts();
    expect(JSON.stringify(counts)).not.toContain("203.0.113.7");
  });

  it("records nothing without a key or a request", () => {
    recordApiKeyDevice(null, req("203.0.113.7"));
    recordApiKeyDevice("k1", null);
    expect(getApiKeyDeviceCounts()).toEqual({});
  });

  it("never throws on a malformed request, since it sits on the request path", () => {
    expect(() => recordApiKeyDevice("k1", {})).not.toThrow();
    expect(() => recordApiKeyDevice("k1", { headers: null })).not.toThrow();
  });
});

describe("the window (#930)", () => {
  it("drops a client that has been silent past the TTL", () => {
    vi.useFakeTimers();
    recordApiKeyDevice("k1", req("203.0.113.7"));
    expect(getApiKeyDeviceCount("k1")).toBe(1);
    vi.advanceTimersByTime(31 * 60 * 1000);
    expect(getApiKeyDeviceCount("k1")).toBe(0);
  });

  it("keeps a client that keeps calling", () => {
    vi.useFakeTimers();
    recordApiKeyDevice("k1", req("203.0.113.7"));
    vi.advanceTimersByTime(20 * 60 * 1000);
    recordApiKeyDevice("k1", req("203.0.113.7"));
    vi.advanceTimersByTime(20 * 60 * 1000);
    expect(getApiKeyDeviceCount("k1")).toBe(1);
  });

  it("forgets a key entirely once its last client expires", () => {
    vi.useFakeTimers();
    recordApiKeyDevice("k1", req("203.0.113.7"));
    vi.advanceTimersByTime(31 * 60 * 1000);
    expect(getApiKeyDeviceCounts()).toEqual({});
  });

  it("caps one key rather than growing without bound between sweeps", () => {
    for (let i = 0; i < 700; i++) recordApiKeyDevice("k1", req(`203.0.113.${i % 256}`, `ua-${i}`));
    expect(getApiKeyDeviceCount("k1")).toBeLessThanOrEqual(500);
  });
});
