import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const REALISTIC_VALIDATION_URLS = [
  "https://accounts.google.com/AccountChooser?continue=https%3A%2F%2Fcloudcode-pa.googleapis.com%2Fv1internal%3AloadCodeAssist&flowName=GlifWebSignIn&opaque=project-secret",
  "https://accounts.google.com/v3/signin/challenge/pwd?continue=https%3A%2F%2Fcloudcode-pa.googleapis.com%2Fv1internal%3AonboardUser&flowName=GlifWebSignIn&opaque=onboard-secret",
];

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

async function storeWith(url) {
  vi.resetModules();
  const store = await import("../../src/lib/antigravityVerification.js");
  store.recordAntigravityValidation("conn-private", {
    observationId: `obs-${url.length}`,
    validation: { kind: "antigravity_validation_required", source: "usage", url },
  });
  return store;
}

afterEach(() => vi.restoreAllMocks());

describe("Antigravity verification privacy boundaries", () => {
  it("keeps action URLs out of getActiveRequests output", () => {
    const contents = source("src/lib/db/repos/usageRepo.js");
    expect(contents).toContain("export async function getActiveRequests()");
    expect(contents).not.toContain("antigravityVerification");
    expect(contents).not.toContain("accounts.google.com");
  });

  it("keeps action URLs out of getUsageStats output", () => {
    const contents = source("src/lib/db/repos/usageRepo.js");
    expect(contents).toContain("export async function getUsageStats");
    expect(contents).not.toContain("antigravityVerification");
    expect(contents).not.toContain("project-secret");
  });

  it("keeps action URLs out of the general usage SSE stream", () => {
    const contents = source("src/app/api/usage/stream/route.js");
    expect(contents).toContain("getUsageStats");
    expect(contents).not.toContain("antigravityVerification");
    expect(contents).not.toContain("accounts.google.com");
  });

  it("keeps action URLs out of request detail and request-log persistence", () => {
    const requestDetails = source("src/lib/db/repos/requestDetailsRepo.js");
    const usage = source("src/lib/db/repos/usageRepo.js");
    expect(requestDetails).not.toContain("antigravityVerification");
    expect(usage).not.toContain("antigravityVerification");
    expect(`${requestDetails}\n${usage}`).not.toContain("onboard-secret");
  });

  it("keeps action URLs out of public error construction", () => {
    const contents = source("open-sse/utils/error.js");
    expect(contents).not.toContain("antigravityVerification");
    expect(contents).not.toContain("accounts.google.com");
    expect(contents).not.toContain("validation.url");
  });

  it("does not use process-global storage for challenge state", () => {
    const contents = source("src/lib/antigravityVerification.js");
    expect(contents).not.toContain("globalThis");
    expect(contents).not.toMatch(/\bglobal\s*\./);
    expect(contents).not.toContain("localStorage");
  });

  it("keeps sensitive snapshots URL-free for both realistic validation URLs", async () => {
    for (const url of REALISTIC_VALIDATION_URLS) {
      const store = await storeWith(url);
      const snapshot = JSON.stringify(store.getAntigravityVerificationSnapshot());
      expect(snapshot).not.toContain(url);
      expect(snapshot).not.toContain("continue=");
      expect(snapshot).not.toContain("flowName=");
    }
  });

  it("keeps sensitive SSE deltas URL-free for both realistic validation URLs", async () => {
    for (const url of REALISTIC_VALIDATION_URLS) {
      const store = await storeWith(url);
      const events = [];
      const unsubscribe = store.subscribeAntigravityVerification((event) => events.push(event));
      store.recordAntigravityValidation("conn-private", {
        observationId: `next-${url.length}`,
        validation: { kind: "antigravity_validation_required", source: "usage", url },
      });
      const current = store.getAntigravityVerification("conn-private");
      store.clearAntigravityVerificationIfCurrent("conn-private", current.challengeId);
      unsubscribe();
      expect(JSON.stringify(events)).not.toContain(url);
      expect(JSON.stringify(events)).not.toContain("project-secret");
      expect(JSON.stringify(events)).not.toContain("onboard-secret");
    }
  });

  it("keeps sensitive-route headers, logs, and redirects free of action URLs", () => {
    const contents = [
      source("src/app/api/providers/antigravity/verification/stream/route.js"),
      source("src/app/api/providers/antigravity/verification/[connectionId]/route.js"),
      source("src/app/api/providers/antigravity/verification/[connectionId]/recheck/route.js"),
    ].join("\n");
    expect(contents).not.toMatch(/console\.(?:log|warn|error)/);
    expect(contents).not.toContain("Location");
    expect(contents).not.toContain("accounts.google.com");
  });

  it("classifies and bounds raw project and chat diagnostics before public sinks", () => {
    const project = source("open-sse/services/projectId.js");
    const chat = source("open-sse/handlers/chatCore.js");
    const executor = source("open-sse/executors/antigravity.js");
    expect(project).toContain("classifyAntigravityValidation({ status: response.status, payload: data, source: \"loadCodeAssist\" })");
    expect(project).toContain("redactAntigravityValidationText");
    expect(chat).toContain("onValidationRequired");
    expect(executor).toContain("ANTIGRAVITY_SAFE_ERROR_MESSAGE");
    expect(`${project}\n${chat}\n${executor}`).not.toContain(REALISTIC_VALIDATION_URLS[0]);
    expect(`${project}\n${chat}\n${executor}`).not.toContain(REALISTIC_VALIDATION_URLS[1]);
  });
});
