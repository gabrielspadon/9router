import { afterEach, describe, expect, it, vi } from "vitest";

const fetchWithTimeout = vi.fn();
vi.mock("../../open-sse/services/usage/shared.js", async () => {
  const actual = await vi.importActual("../../open-sse/services/usage/shared.js");
  return { ...actual, fetchWithTimeout };
});

const VALIDATION_URL = "https://accounts.google.com/AccountChooser?token=usage-secret";

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function onceTextResponse(payload, status = 200) {
  let reads = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    async text() {
      reads += 1;
      if (reads > 1) throw new Error("body read twice");
      return JSON.stringify(payload);
    },
    get reads() { return reads; },
  };
}

function hooks({ observationId = "obs-usage", challengeIdAtStart = "challenge-usage" } = {}) {
  return {
    verificationContext: { connectionId: "conn-usage", observationId, challengeIdAtStart },
    onValidationRequired: vi.fn(),
    onVerificationSuccess: vi.fn(),
  };
}

function rpcValidation() {
  return {
    error: {
      code: 403,
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          domain: "cloudcode-pa.googleapis.com",
          reason: "VALIDATION_REQUIRED",
          metadata: {},
        },
        {
          "@type": "type.googleapis.com/google.rpc.Help",
          links: [{ url: VALIDATION_URL }],
        },
      ],
    },
  };
}

async function loadGoogle(responses) {
  vi.resetModules();
  fetchWithTimeout.mockReset();
  for (const item of responses) fetchWithTimeout.mockResolvedValueOnce(item);
  return import("../../open-sse/services/usage/google.js");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Antigravity usage verification", () => {
  it("reports a successful subscription validation challenge", async () => {
    const google = await loadGoogle([
      jsonResponse({ ineligibleTiers: [{ reasonCode: "VALIDATION_REQUIRED", validationUrl: VALIDATION_URL }] }),
      jsonResponse({ models: {} }),
    ]);
    const listener = hooks();

    await google.getAntigravityUsage("token", {}, null, listener);
    expect(listener.onValidationRequired).toHaveBeenCalledWith({
      validation: { kind: "antigravity_validation_required", url: VALIDATION_URL, source: "loadCodeAssist" },
      observationId: "obs-usage",
    });
  });

  it("reports a strict subscription 403 challenge", async () => {
    const google = await loadGoogle([jsonResponse(rpcValidation(), 403), jsonResponse({ models: {} })]);
    const listener = hooks();

    await google.getAntigravityUsage("token", {}, null, listener);
    expect(listener.onValidationRequired).toHaveBeenCalledWith(expect.objectContaining({ observationId: "obs-usage" }));
  });

  it("reports a strict quota 403 challenge", async () => {
    const google = await loadGoogle([jsonResponse({}), jsonResponse(rpcValidation(), 403)]);
    const listener = hooks();

    await google.getAntigravityUsage("token", {}, null, listener);
    expect(listener.onValidationRequired).toHaveBeenCalledWith(expect.objectContaining({ observationId: "obs-usage" }));
  });

  it("marks a usable models response and terminally clears its snapshot", async () => {
    const google = await loadGoogle([jsonResponse({}), jsonResponse({ models: {} })]);
    const listener = hooks();

    const result = await google.getAntigravityUsage("token", {}, null, listener);
    expect(google.isUsableAntigravityUsageResult(result)).toBe(true);
    expect(listener.onVerificationSuccess).toHaveBeenCalledWith({ challengeId: "challenge-usage" });
  });

  it("reads the subscription response exactly once as text", async () => {
    const subscription = onceTextResponse({});
    const google = await loadGoogle([subscription, jsonResponse({ models: {} })]);

    await google.getAntigravityUsage("token", {});
    expect(subscription.reads).toBe(1);
  });

  it("reads the quota response exactly once as text", async () => {
    const quota = onceTextResponse({ models: {} });
    const google = await loadGoogle([jsonResponse({}), quota]);

    await google.getAntigravityUsage("token", {});
    expect(quota.reads).toBe(1);
  });

  it("fails open when a validation callback rejects and keeps the URL redacted", async () => {
    const google = await loadGoogle([
      jsonResponse({ ineligibleTiers: [{ reasonCode: "VALIDATION_REQUIRED", validationUrl: VALIDATION_URL }] }),
      jsonResponse({ models: {} }),
    ]);
    const listener = hooks();
    listener.onValidationRequired.mockRejectedValue(new Error("listener failed"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(google.getAntigravityUsage("token", {}, null, listener)).resolves.toEqual(expect.any(Object));
    expect(listener.onValidationRequired).toHaveBeenCalledOnce();
    expect(error.mock.calls.flat().join(" ")).not.toContain(VALIDATION_URL);
    expect(error.mock.calls.flat().join(" ")).not.toContain("usage-secret");
  });

  it("does not clear a message-only quota result", async () => {
    const google = await loadGoogle([jsonResponse({}), jsonResponse({ message: "try later" })]);
    const listener = hooks();

    await google.getAntigravityUsage("token", {}, null, listener);
    expect(listener.onVerificationSuccess).not.toHaveBeenCalled();
  });

  it("does not clear from subscription data alone", async () => {
    const google = await loadGoogle([jsonResponse({ currentTier: { name: "Free" } }), jsonResponse({})]);
    const listener = hooks();

    await google.getAntigravityUsage("token", {}, null, listener);
    expect(listener.onVerificationSuccess).not.toHaveBeenCalled();
  });

  it("does not clear a malformed successful quota payload", async () => {
    const google = await loadGoogle([jsonResponse({}), jsonResponse(null)]);
    const listener = hooks();

    await google.getAntigravityUsage("token", {}, null, listener);
    expect(listener.onVerificationSuccess).not.toHaveBeenCalled();
  });

  it("does not clear an HTTP quota error", async () => {
    const google = await loadGoogle([jsonResponse({}), jsonResponse({ error: "bad" }, 500)]);
    const listener = hooks();

    await google.getAntigravityUsage("token", {}, null, listener);
    expect(listener.onVerificationSuccess).not.toHaveBeenCalled();
  });

  it("does not clear a transport failure", async () => {
    vi.resetModules();
    fetchWithTimeout.mockReset();
    fetchWithTimeout.mockRejectedValueOnce(new Error("offline"));
    const google = await import("../../open-sse/services/usage/google.js");
    const listener = hooks();

    await google.getAntigravityUsage("token", {}, null, listener);
    expect(listener.onVerificationSuccess).not.toHaveBeenCalled();
  });
});
