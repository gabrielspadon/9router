// #3106 — "the details page of usage is not working anymore" on v0.5.50.
//
// v0.5.50 made request-detail recording opt-in (CHANGELOG v0.5.50, "observability
// defaults to off (opt-in)"; src/lib/db/repos/settingsRepo.js `enableObservability:
// false`). An install that used to fill the Usage → Details tab therefore records
// nothing, and `/api/usage/request-details` answered `{ details: [] }` either way,
// which is indistinguishable from "no traffic matched" — so a disabled feature
// reads as a broken page. The route now states which of the two it is.
import { describe, it, expect, vi, beforeEach } from "vitest";

const getRequestDetails = vi.fn();
const isObservabilityEnabled = vi.fn();

vi.mock("@/lib/usageDb", () => ({ getRequestDetails: (...a) => getRequestDetails(...a) }));
vi.mock("@/lib/requestDetailsDb", () => ({
  isObservabilityEnabled: (...a) => isObservabilityEnabled(...a),
}));

const { GET } = await import("@/app/api/usage/request-details/route.js");

const call = (qs = "") =>
  GET(new Request(`http://localhost/api/usage/request-details${qs}`)).then((r) => r.json());

const emptyPage = {
  details: [],
  pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0, hasNext: false, hasPrev: false },
};

beforeEach(() => {
  getRequestDetails.mockReset().mockResolvedValue(emptyPage);
  isObservabilityEnabled.mockReset().mockResolvedValue(true);
});

describe("request details say whether recording is on (#3106)", () => {
  it("marks an empty page as disabled when nothing is being recorded", async () => {
    isObservabilityEnabled.mockResolvedValue(false);
    const body = await call();
    expect(body.details).toEqual([]);
    expect(body.observability).toEqual({ enabled: false });
  });

  it("marks the same empty page as enabled when recording is on", async () => {
    const body = await call();
    expect(body.details).toEqual([]);
    // Same payload as above but a different cause, which is the whole point.
    expect(body.observability).toEqual({ enabled: true });
  });

  it("reports the state alongside real rows too, not only empty ones", async () => {
    getRequestDetails.mockResolvedValue({
      details: [{ id: "1", model: "gpt", request: { messages: ["secret"] } }],
      pagination: { ...emptyPage.pagination, totalItems: 1, totalPages: 1 },
    });
    const body = await call();
    expect(body.observability).toEqual({ enabled: true });
    expect(body.pagination.totalItems).toBe(1);
    // The redaction this route already performs must survive the addition.
    expect(body.details[0].request).toEqual({ redacted: true });
    expect(body.details[0].model).toBe("gpt");
  });

  it("still rejects a bad page before touching the DB at all", async () => {
    const res = await GET(new Request("http://localhost/api/usage/request-details?page=0"));
    expect(res.status).toBe(400);
    expect(getRequestDetails).not.toHaveBeenCalled();
  });

  it("does not fail the request when the recording state cannot be read", async () => {
    isObservabilityEnabled.mockRejectedValue(new Error("settings unavailable"));
    const res = await GET(new Request("http://localhost/api/usage/request-details"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Unknown is reported as off: the tab's empty state should not claim
    // recording is on when nothing could confirm it.
    expect(body.observability).toEqual({ enabled: false });
    expect(body.details).toEqual([]);
  });
});
