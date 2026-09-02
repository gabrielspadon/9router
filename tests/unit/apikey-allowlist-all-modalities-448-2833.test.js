// Issues #448 and #2833, reported independently upstream: the per-key model
// allowlist shipped with #1154 was enforced in exactly ONE handler, rerank. A
// key restricted to cheap models could therefore reach any model in the router
// by asking on /v1/chat/completions, embeddings, images, audio, video or the
// json proxy instead. The allowlist was an access control with one door locked.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

let allowed = null;
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  isModelAllowed: async (key, model) => {
    if (!key || allowed === null) return true;
    return allowed.includes(model);
  },
}));

const { refuseDisallowedModel } = await import("@/sse/services/modelAccess.js");

beforeEach(() => { allowed = null; });

describe("the guard itself (#448, #2833)", () => {
  it("passes a model the key is allowed to use", async () => {
    allowed = ["cheap/tiny"];
    expect(await refuseDisallowedModel("k", "cheap/tiny")).toBeNull();
  });

  it("refuses a model the key is not allowed to use, with 403", async () => {
    allowed = ["cheap/tiny"];
    const res = await refuseDisallowedModel("k", "big/flagship");
    expect(res).not.toBeNull();
    expect(res.status).toBe(403);
  });

  it("names the refused model, so the caller can see why", async () => {
    allowed = ["cheap/tiny"];
    const body = await (await refuseDisallowedModel("k", "big/flagship")).json();
    expect(JSON.stringify(body)).toContain("big/flagship");
  });

  it("is inert with no key, which is local mode", async () => {
    allowed = ["cheap/tiny"];
    expect(await refuseDisallowedModel(null, "big/flagship")).toBeNull();
  });

  it("is inert with no model rather than refusing the request", async () => {
    allowed = ["cheap/tiny"];
    expect(await refuseDisallowedModel("k", null)).toBeNull();
  });

  it("is inert when the key carries no allowlist", async () => {
    allowed = null;
    expect(await refuseDisallowedModel("k", "anything/at-all")).toBeNull();
  });
});

// The regression that matters is a NEW modality forgetting the check, which is
// exactly how this hole opened. Assert against the handler directory rather
// than a hardcoded list, so a handler added later fails this test until wired.
describe("every public modality enforces it (#448, #2833)", () => {
  const DIR = new URL("../../src/sse/handlers/", import.meta.url);
  const EXEMPT = new Set([
    "shared.js",        // helper, not a modality
    "responses.js",     // delegates into chat.js
  ]);

  const handlers = readdirSync(DIR)
    .filter((f) => f.endsWith(".js") && !EXEMPT.has(f))
    .filter((f) => readFileSync(new URL(f, DIR), "utf8").includes("isValidApiKey"));

  it("finds the handler set at all", () => {
    expect(handlers.length).toBeGreaterThanOrEqual(8);
  });

  for (const f of handlers) {
    it(`${f} consults the key's model allowlist`, () => {
      const src = readFileSync(new URL(f, DIR), "utf8");
      // rerank had the original inline check; everything else uses the shared
      // guard. Either satisfies the invariant: the allowlist is consulted.
      const consults = src.includes("refuseDisallowedModel") || src.includes("isModelAllowed");
      expect(consults, `${f} validates an API key but never checks its model allowlist`).toBe(true);
    });
  }
});
