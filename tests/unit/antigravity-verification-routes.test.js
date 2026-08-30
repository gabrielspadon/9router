import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { identityRows, mutationRows } from "../fixtures/antigravity-verification-access.js";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  authorizeMutation: vi.fn(),
  getConnection: vi.fn(),
  getSnapshot: vi.fn(),
  getVerification: vi.fn(),
  subscribe: vi.fn(),
  clear: vi.fn(),
  runProbe: vi.fn(),
  usable: vi.fn(),
  resolveProxy: vi.fn(),
}));

function withHeaders(headers = {}) {
  return new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
}

function json(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: withHeaders({ "content-type": "application/json; charset=utf-8", ...headers }),
  });
}

vi.mock("@/lib/auth/antigravityVerificationAccess", () => ({
  authorizeAntigravityVerification: mocks.authorize,
  authorizeAntigravityVerificationMutation: mocks.authorizeMutation,
  withAntigravityVerificationHeaders: withHeaders,
  antigravityVerificationJson: json,
}));
vi.mock("@/lib/db/index.js", () => ({ getProviderConnectionById: mocks.getConnection }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: mocks.resolveProxy }));
vi.mock("@/lib/antigravityVerification", () => ({
  getAntigravityVerificationSnapshot: mocks.getSnapshot,
  getAntigravityVerification: mocks.getVerification,
  subscribeAntigravityVerification: mocks.subscribe,
  clearAntigravityVerificationIfCurrent: mocks.clear,
  runAntigravityUsageProbe: mocks.runProbe,
}));
vi.mock("open-sse/services/usage/google.js", () => ({ isUsableAntigravityUsageResult: mocks.usable }));

import { GET as streamGET } from "../../src/app/api/providers/antigravity/verification/stream/route.js";
import { DELETE as dismissDELETE, GET as detailGET } from "../../src/app/api/providers/antigravity/verification/[connectionId]/route.js";
import { POST as recheckPOST } from "../../src/app/api/providers/antigravity/verification/[connectionId]/recheck/route.js";

const href = "https://accounts.google.com/AccountChooser?continue=https%3A%2F%2Fcloudcode-pa.googleapis.com%2Fv1internal%3AloadCodeAssist&opaque=project-secret";
const current = { connectionId: "conn-a", challengeId: "challenge-a", expiresAt: 123456, href };
const connection = { id: "conn-a", provider: "antigravity", providerSpecificData: {} };
const params = { params: Promise.resolve({ connectionId: "conn-a" }) };

function readRequest(signal) {
  return new Request("http://localhost:20128/api/providers/antigravity/verification/stream", { signal });
}

function mutationRequest(challengeId = current.challengeId) {
  return new Request("http://localhost:20128/api/providers/antigravity/verification/conn-a", {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:20128",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify({ challengeId }),
  });
}

async function readChunk(response) {
  const reader = response.body.getReader();
  const { value, done } = await reader.read();
  return { reader, done, text: new TextDecoder().decode(value) };
}

function allowed(viaCli = false) {
  return { ok: true, viaCli };
}

function denied(status = 401) {
  return { ok: false, response: json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status }) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue(allowed());
  mocks.authorizeMutation.mockResolvedValue(allowed());
  mocks.getConnection.mockResolvedValue(connection);
  mocks.getSnapshot.mockReturnValue([{ connectionId: current.connectionId, challengeId: current.challengeId, expiresAt: current.expiresAt }]);
  mocks.getVerification.mockReturnValue(current);
  mocks.subscribe.mockReturnValue(vi.fn());
  mocks.clear.mockReturnValue(true);
  mocks.runProbe.mockResolvedValue({});
  mocks.usable.mockReturnValue(false);
  mocks.resolveProxy.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Antigravity verification routes", () => {
  describe("stream", () => {
    it("sends an initial sanitized snapshot with exact SSE headers", async () => {
      const response = await streamGET(readRequest());
      const { reader, text } = await readChunk(response);

      expect(text).toBe(`event: snapshot\ndata: ${JSON.stringify({ entries: mocks.getSnapshot.mock.results[0].value })}\n\n`);
      expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
      expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0, no-transform");
      expect(response.headers.get("x-accel-buffering")).toBe("no");
      await reader.cancel();
    });

    it("sends sanitized upsert and remove deltas", async () => {
      let listener;
      mocks.subscribe.mockImplementation((candidate) => {
        listener = candidate;
        return vi.fn();
      });
      const response = await streamGET(readRequest());
      const reader = response.body.getReader();
      await reader.read();
      listener({ type: "upsert", connectionId: "conn-b", challengeId: "challenge-b", expiresAt: 99, href });
      const upsert = await reader.read();
      listener({ type: "remove", connectionId: "conn-b", challengeId: "challenge-b", href });
      const remove = await reader.read();

      expect(new TextDecoder().decode(upsert.value)).toBe("event: upsert\ndata: {\"connectionId\":\"conn-b\",\"challengeId\":\"challenge-b\",\"expiresAt\":99}\n\n");
      expect(new TextDecoder().decode(remove.value)).toBe("event: remove\ndata: {\"connectionId\":\"conn-b\",\"challengeId\":\"challenge-b\"}\n\n");
      await reader.cancel();
    });

    it("writes a 25-second comment heartbeat", async () => {
      const response = await streamGET(readRequest());
      const reader = response.body.getReader();
      await reader.read();
      await vi.advanceTimersByTimeAsync(25_000);
      const heartbeat = await reader.read();

      expect(new TextDecoder().decode(heartbeat.value)).toBe(": heartbeat\n\n");
      await reader.cancel();
    });

    it("cleans up on request abort", async () => {
      const controller = new AbortController();
      const unsubscribe = vi.fn();
      mocks.subscribe.mockReturnValue(unsubscribe);
      const response = await streamGET(readRequest(controller.signal));
      const reader = response.body.getReader();
      await reader.read();
      controller.abort();
      await Promise.resolve();

      expect(unsubscribe).toHaveBeenCalledOnce();
      await reader.cancel();
    });

    it("cleans up once on stream cancel without growing listeners", async () => {
      const unsubscribe = vi.fn();
      mocks.subscribe.mockReturnValue(unsubscribe);
      const response = await streamGET(readRequest());
      const { reader } = await readChunk(response);
      await reader.cancel();
      await reader.cancel();

      expect(mocks.subscribe).toHaveBeenCalledOnce();
      expect(unsubscribe).toHaveBeenCalledOnce();
    });
  });

  describe("detail", () => {
    it("returns exactly the private detail shape", async () => {
      const response = await detailGET(readRequest(), params);
      expect(await response.json()).toEqual({ challengeId: current.challengeId, expiresAt: current.expiresAt, href });
    });

    it("shares one 404 body for a missing connection", async () => {
      mocks.getConnection.mockResolvedValue(null);
      const response = await detailGET(readRequest(), params);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Verification challenge not found" });
    });

    it("shares that 404 body for a non-Antigravity connection", async () => {
      mocks.getConnection.mockResolvedValue({ ...connection, provider: "gemini-cli" });
      const response = await detailGET(readRequest(), params);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Verification challenge not found" });
    });

    it("shares that 404 body when no challenge is live", async () => {
      mocks.getVerification.mockReturnValue(null);
      const response = await detailGET(readRequest(), params);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Verification challenge not found" });
    });

    it("shares that 404 body when expiry has removed the challenge", async () => {
      mocks.getVerification.mockReturnValue(null);
      const response = await detailGET(readRequest(), params);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Verification challenge not found" });
    });
  });

  describe("dismissal", () => {
    it("returns 204 for the matching current challenge", async () => {
      const response = await dismissDELETE(mutationRequest(), params);
      expect(response.status).toBe(204);
      expect(mocks.clear).toHaveBeenCalledWith("conn-a", "challenge-a");
    });

    it("returns 409 for a stale challenge without returning the replacement", async () => {
      const response = await dismissDELETE(mutationRequest("stale-id"), params);
      expect(response.status).toBe(409);
      const payload = await response.json();
      expect(payload).toEqual({ error: "Verification challenge changed" });
      expect(JSON.stringify(payload).includes(current.challengeId)).toBe(false);
    });

    it("returns 404 when there is no live challenge to dismiss", async () => {
      mocks.getVerification.mockReturnValue(null);
      const response = await dismissDELETE(mutationRequest(), params);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Verification challenge not found" });
    });

    it("runs CSRF before reading bodies across every mutation fixture", async () => {
      for (const row of mutationRows) {
        const jsonSpy = vi.fn(async () => ({ challengeId: current.challengeId }));
        const request = {
          headers: new Headers(row.headers),
          url: "http://localhost:20128/api/providers/antigravity/verification/conn-a",
          json: jsonSpy,
        };
        mocks.authorizeMutation.mockResolvedValueOnce(row.allowed ? allowed(Boolean(row.cli)) : denied(403));
        const response = await dismissDELETE(request, params);
        if (row.allowed) expect(jsonSpy).toHaveBeenCalledOnce();
        else expect(jsonSpy).not.toHaveBeenCalled();
        expect(response.status).toBe(row.allowed ? 204 : 403);
      }
    });

    it("leaves the provider connection row untouched", async () => {
      await dismissDELETE(mutationRequest(), params);
      expect(mocks.getConnection).toHaveBeenCalledWith("conn-a");
      expect(mocks.getConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe("recheck", () => {
    it("returns verified only when a usable probe clears the submitted challenge", async () => {
      const usable = {};
      mocks.usable.mockReturnValue(true);
      mocks.runProbe.mockResolvedValue(usable);
      mocks.getVerification.mockReturnValueOnce(current).mockReturnValue(null);
      const request = new Request("http://localhost:20128/api/providers/antigravity/verification/conn-a/recheck", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:20128", "sec-fetch-site": "same-origin" },
        body: JSON.stringify({ challengeId: current.challengeId }),
      });
      const response = await recheckPOST(request, params);

      expect(await response.json()).toEqual({ verified: true });
      expect(mocks.runProbe).toHaveBeenCalledWith(connection, expect.any(Object), { force: true, expectedChallengeId: current.challengeId });
    });

    it("returns false for a usable probe that records a concurrent replacement", async () => {
      mocks.usable.mockReturnValue(true);
      mocks.getVerification.mockReturnValueOnce(current).mockReturnValue({ ...current, challengeId: "replacement" });
      const request = new Request("http://localhost:20128/api/providers/antigravity/verification/conn-a/recheck", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:20128", "sec-fetch-site": "same-origin" },
        body: JSON.stringify({ challengeId: current.challengeId }),
      });
      const response = await recheckPOST(request, params);
      expect(await response.json()).toEqual({ verified: false });
    });

    it("rejects every denied identity on all four sensitive methods", async () => {
      for (const row of identityRows) {
        mocks.authorize.mockResolvedValue(denied());
        mocks.authorizeMutation.mockResolvedValue(denied());
        const stream = await streamGET(readRequest());
        const detail = await detailGET(readRequest(), params);
        const dismiss = await dismissDELETE(mutationRequest(), params);
        const recheck = await recheckPOST(mutationRequest(), params);
        expect([stream.status, detail.status, dismiss.status, recheck.status], row.name).toEqual([401, 401, 401, 401]);
      }
    });

    it("returns a bounded 502 for transport failure", async () => {
      mocks.runProbe.mockRejectedValue(new Error(`upstream ${href}`));
      const response = await recheckPOST(mutationRequest(), params);
      expect(response.status).toBe(502);
      expect(JSON.stringify(await response.json())).not.toContain(href);
    });

    it("returns a bounded 502 for a malformed unmarked result", async () => {
      mocks.runProbe.mockResolvedValue({ quotas: [] });
      const response = await recheckPOST(mutationRequest(), params);
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "Verification recheck failed" });
    });

    it("returns a bounded 502 for a generic provider failure", async () => {
      mocks.runProbe.mockResolvedValue({ message: "provider failed" });
      const response = await recheckPOST(mutationRequest(), params);
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "Verification recheck failed" });
    });

    it("returns 409 before probing a stale submitted challenge", async () => {
      const response = await recheckPOST(mutationRequest("stale-id"), params);
      expect(response.status).toBe(409);
      expect(mocks.runProbe).not.toHaveBeenCalled();
    });

    it("returns the shared 404 before probing a non-Antigravity connection", async () => {
      mocks.getConnection.mockResolvedValue({ ...connection, provider: "gemini-cli" });
      const response = await recheckPOST(mutationRequest(), params);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Verification challenge not found" });
      expect(mocks.runProbe).not.toHaveBeenCalled();
    });
  });
});
