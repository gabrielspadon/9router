import { afterEach, describe, expect, it, vi } from "vitest";

const VALIDATION_URL = "https://accounts.google.com/AccountChooser?token=project-secret";

function validationPayload() {
  return {
    cloudaicompanionProject: "must-not-win-over-validation",
    ineligibleTiers: [{ reasonCode: "VALIDATION_REQUIRED", validationUrl: VALIDATION_URL }],
  };
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function hooks({ observationId = "obs-1", challengeIdAtStart = "challenge-A" } = {}) {
  return {
    verificationContext: { connectionId: "conn-A", observationId, challengeIdAtStart },
    onValidationRequired: vi.fn(),
    onVerificationSuccess: vi.fn(),
  };
}

let projectId;

async function loadProjectId(fetchImpl) {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  projectId = await import("../../open-sse/services/projectId.js");
  return projectId;
}

afterEach(() => {
  projectId?.stopCacheCleanup?.();
  projectId = null;
  vi.unstubAllGlobals();
});

describe("Antigravity project verification outcomes", () => {
  it("does not notify hooks from a cached project result", async () => {
    const mod = await loadProjectId(async () => response({ cloudaicompanionProject: "project-A" }));
    const first = hooks();
    const second = hooks({ observationId: "obs-2", challengeIdAtStart: "challenge-B" });

    await expect(mod.getProjectIdForConnection("conn-A", "token", "antigravity", first)).resolves.toBe("project-A");
    first.onValidationRequired.mockClear();
    first.onVerificationSuccess.mockClear();
    await expect(mod.getProjectIdForConnection("conn-A", "token", "antigravity", second)).resolves.toBe("project-A");
    expect(first.onValidationRequired).not.toHaveBeenCalled();
    expect(first.onVerificationSuccess).not.toHaveBeenCalled();
    expect(second.onValidationRequired).not.toHaveBeenCalled();
    expect(second.onVerificationSuccess).not.toHaveBeenCalled();
  });

  it("reports a strict loadCodeAssist challenge to its initiator", async () => {
    const mod = await loadProjectId(async () => response(validationPayload()));
    const listener = hooks();

    await expect(mod.getProjectIdForConnection("conn-A", "token", "antigravity", listener)).resolves.toBeNull();
    expect(listener.onValidationRequired).toHaveBeenCalledWith({
      validation: { kind: "antigravity_validation_required", url: VALIDATION_URL, source: "loadCodeAssist" },
      observationId: "obs-1",
    });
  });

  it("delivers one typed validation outcome and observation to late waiters", async () => {
    const gate = deferred();
    const mod = await loadProjectId(() => gate.promise);
    const first = hooks({ observationId: "obs-first" });
    const late = hooks({ observationId: "obs-late" });

    const one = mod.getProjectIdForConnection("conn-A", "token", "antigravity", first);
    const two = mod.getProjectIdForConnection("conn-A", "token", "antigravity", late);
    gate.resolve(response(validationPayload()));

    await expect(Promise.all([one, two])).resolves.toEqual([null, null]);
    expect(first.onValidationRequired).toHaveBeenCalledWith(expect.objectContaining({ observationId: "obs-first" }));
    expect(late.onValidationRequired).toHaveBeenCalledWith(expect.objectContaining({ observationId: "obs-first" }));
  });

  it("isolates a throwing validation waiter from another waiter", async () => {
    const mod = await loadProjectId(async () => response(validationPayload()));
    const throwing = hooks();
    throwing.onValidationRequired.mockImplementation(() => { throw new Error("listener failure"); });
    const healthy = hooks({ observationId: "obs-healthy" });

    await expect(Promise.all([
      mod.getProjectIdForConnection("conn-A", "token", "antigravity", throwing),
      mod.getProjectIdForConnection("conn-A", "token", "antigravity", healthy),
    ])).resolves.toEqual([null, null]);
    expect(healthy.onValidationRequired).toHaveBeenCalledWith(expect.objectContaining({ observationId: "obs-1" }));
  });

  it("notifies every waiter when a project probe succeeds", async () => {
    const gate = deferred();
    const mod = await loadProjectId(() => gate.promise);
    const first = hooks();
    const late = hooks({ observationId: "obs-late" });

    const one = mod.getProjectIdForConnection("conn-A", "token", "antigravity", first);
    const two = mod.getProjectIdForConnection("conn-A", "token", "antigravity", late);
    gate.resolve(response({ cloudaicompanionProject: "project-A" }));

    await expect(Promise.all([one, two])).resolves.toEqual(["project-A", "project-A"]);
    expect(first.onVerificationSuccess).toHaveBeenCalledWith({ challengeId: "challenge-A" });
    expect(late.onVerificationSuccess).toHaveBeenCalledWith({ challengeId: "challenge-A" });
  });

  it("uses the first initiator challenge snapshot for project success", async () => {
    const gate = deferred();
    const mod = await loadProjectId(() => gate.promise);
    const first = hooks({ challengeIdAtStart: "challenge-first" });
    const late = hooks({ challengeIdAtStart: "challenge-late" });

    const one = mod.getProjectIdForConnection("conn-A", "token", "antigravity", first);
    const two = mod.getProjectIdForConnection("conn-A", "token", "antigravity", late);
    gate.resolve(response({ cloudaicompanionProject: "project-A" }));

    await Promise.all([one, two]);
    expect(first.onVerificationSuccess).toHaveBeenCalledWith({ challengeId: "challenge-first" });
    expect(late.onVerificationSuccess).toHaveBeenCalledWith({ challengeId: "challenge-first" });
  });

  it("does not notify hooks when project lookup fails", async () => {
    const mod = await loadProjectId(async () => { throw new Error("network down"); });
    const listener = hooks();

    await expect(mod.getProjectIdForConnection("conn-A", "token", "antigravity", listener)).resolves.toBeNull();
    expect(listener.onValidationRequired).not.toHaveBeenCalled();
    expect(listener.onVerificationSuccess).not.toHaveBeenCalled();
  });

  it("uses the fixed Antigravity message for an opaque loadCodeAssist 500 diagnostic", async () => {
    const opaque = "opaque-project-500-secret";
    const mod = await loadProjectId(async () => response({ error: { message: opaque } }, 500));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(mod.getProjectIdForConnection("conn-A", "token", "antigravity", hooks())).resolves.toBeNull();

    expect(JSON.stringify(warn.mock.calls)).not.toContain(opaque);
    expect(JSON.stringify(warn.mock.calls)).toContain("Antigravity upstream request failed");
  });

  it("uses the fixed Antigravity message for an opaque project transport diagnostic", async () => {
    const opaque = "opaque-project-throw-secret";
    const mod = await loadProjectId(async () => { throw new Error(opaque); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(mod.getProjectIdForConnection("conn-A", "token", "antigravity", hooks())).resolves.toBeNull();

    expect(JSON.stringify(warn.mock.calls)).not.toContain(opaque);
    expect(JSON.stringify(warn.mock.calls)).toContain("Antigravity upstream request failed");
  });

  it("does not report success after its connection has been released", async () => {
    const gate = deferred();
    const fetchImpl = vi.fn()
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValueOnce(response({ cloudaicompanionProject: "project-B" }));
    const mod = await loadProjectId(fetchImpl);
    const listener = hooks();

    const result = mod.getProjectIdForConnection("conn-A", "token", "antigravity", listener);
    mod.removeConnection("conn-A");
    gate.resolve(response({ cloudaicompanionProject: "project-A" }));

    await result;
    expect(listener.onVerificationSuccess).not.toHaveBeenCalled();
    await expect(mod.getProjectIdForConnection("conn-A", "token", "antigravity", hooks())).resolves.toBe("project-B");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps typed outcomes independent for different connections", async () => {
    const mod = await loadProjectId(async (_url, options) => response({
      cloudaicompanionProject: options.headers.Authorization.endsWith("one") ? "project-one" : "project-two",
    }));
    const one = hooks({ challengeIdAtStart: "challenge-one" });
    const two = hooks({ challengeIdAtStart: "challenge-two" });

    await expect(Promise.all([
      mod.getProjectIdForConnection("conn-one", "one", "antigravity", one),
      mod.getProjectIdForConnection("conn-two", "two", "antigravity", two),
    ])).resolves.toEqual(["project-one", "project-two"]);
    expect(one.onVerificationSuccess).toHaveBeenCalledWith({ challengeId: "challenge-one" });
    expect(two.onVerificationSuccess).toHaveBeenCalledWith({ challengeId: "challenge-two" });
  });

  it("evicts cached project values at the connection lifecycle boundary", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ cloudaicompanionProject: "project-A" }))
      .mockResolvedValueOnce(response({ cloudaicompanionProject: "project-B" }));
    const mod = await loadProjectId(fetchImpl);
    const first = hooks();
    const second = hooks({ challengeIdAtStart: "challenge-B" });

    await expect(mod.getProjectIdForConnection("conn-A", "token", "antigravity", first)).resolves.toBe("project-A");
    mod.removeConnection("conn-A");
    await expect(mod.getProjectIdForConnection("conn-A", "token", "antigravity", second)).resolves.toBe("project-B");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(first.onVerificationSuccess).toHaveBeenCalledWith({ challengeId: "challenge-A" });
    expect(second.onVerificationSuccess).toHaveBeenCalledWith({ challengeId: "challenge-B" });
  });

  it("does not let a released same-ID operation overwrite its replacement cache", async () => {
    const firstGate = deferred();
    const fetchImpl = vi.fn()
      .mockImplementationOnce(() => firstGate.promise)
      .mockResolvedValueOnce(response({ cloudaicompanionProject: "project-B" }));
    const mod = await loadProjectId(fetchImpl);

    const first = mod.getProjectIdForConnection("conn-A", "token", "antigravity", hooks({ challengeIdAtStart: "challenge-A" }));
    mod.removeConnection("conn-A");
    await expect(mod.getProjectIdForConnection("conn-A", "token", "antigravity", hooks({ challengeIdAtStart: "challenge-B" }))).resolves.toBe("project-B");
    firstGate.resolve(response({ cloudaicompanionProject: "project-A" }));
    await first;

    await expect(mod.getProjectIdForConnection("conn-A", "token", "antigravity", hooks({ challengeIdAtStart: "challenge-C" }))).resolves.toBe("project-B");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
