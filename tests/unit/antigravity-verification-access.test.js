import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { identityRows, mutationRows } from "../fixtures/antigravity-verification-access.js";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
  hasValidCliToken: vi.fn(),
  hasTrustedPeerHeaders: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: mocks.verifyDashboardAuthToken }));
vi.mock("@/dashboardGuard", () => ({ hasValidCliToken: mocks.hasValidCliToken }));
vi.mock("@/lib/auth/trustedPeer", () => ({ hasTrustedPeerHeaders: mocks.hasTrustedPeerHeaders }));

function requestFor({ headers = {}, jwt = false } = {}) {
  const request = new Request("http://localhost:20128/api/providers/antigravity/verification/stream", { headers });
  Object.defineProperty(request, "cookies", { value: { get: () => jwt ? { value: "jwt" } : undefined } });
  return request;
}

beforeEach(() => {
  vi.resetModules();
  mocks.getSettings.mockResolvedValue({ requireLogin: true });
  mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  mocks.hasValidCliToken.mockResolvedValue(false);
  mocks.hasTrustedPeerHeaders.mockImplementation((request) => request.headers.get("x-tp-peer-token") === "trusted");
});

afterEach(() => vi.restoreAllMocks());

describe("Antigravity verification access", () => {
  describe.each([true, false])("requireLogin=%s", (requireLogin) => {
    it.each(identityRows)("authorizes $name only through approved identity", async (row) => {
      const { authorizeAntigravityVerification } = await import("../../src/lib/auth/antigravityVerificationAccess.js");
      mocks.getSettings.mockResolvedValue({ requireLogin });
      mocks.verifyDashboardAuthToken.mockResolvedValue(Boolean(row.jwt));
      mocks.hasValidCliToken.mockResolvedValue(Boolean(row.cli));
      const headers = {
        ...(row.trusted ? { "x-tp-peer-token": "trusted" } : {}),
        ...(row.realIp ? { "x-tp-real-ip": row.realIp } : {}),
        ...(row.proxied ? { "x-tp-via-proxy": "1" } : {}),
      };
      const result = await authorizeAntigravityVerification(requestFor({ headers, jwt: row.jwt }));
      const expected = requireLogin ? row.expected : row.expectedNoLogin;
      expect(result.ok).toBe(expected);
      if (!expected) {
        expect(result.response.status).toBe(401);
        expect(result.response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
      }
    });
  });

  it.each(mutationRows)("enforces mutation CSRF for $name", async (row) => {
    const { authorizeAntigravityVerificationMutation } = await import("../../src/lib/auth/antigravityVerificationAccess.js");
    mocks.verifyDashboardAuthToken.mockResolvedValue(!row.cli);
    mocks.hasValidCliToken.mockResolvedValue(Boolean(row.cli));
    const result = await authorizeAntigravityVerificationMutation(requestFor({ headers: row.headers }));

    expect(result.ok).toBe(row.allowed);
    if (!row.allowed) {
      expect(result.response.status).toBe(403);
      expect(result.response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
      expect(result.response.headers.get("pragma")).toBe("no-cache");
      expect(result.response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(result.response.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });
});
