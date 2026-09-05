import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";
import antigravityRegistry from "../../open-sse/providers/registry/antigravity.js";

// config.js is the CJS MITM bundle module (dependency-isolated for the runtime copy).
const require = createRequire(import.meta.url);
const { MODEL_NO_MAP } = require("../../src/mitm/config.js");

// All assertions below are grounded in a live MITM dump capture of Antigravity's
// streamGenerateContent requests (see AI_JOURNAL): the agent loop sends
// `gemini-3.5-flash-low`, tab-autocomplete sends `tab_jump_flash_lite_preview` /
// `tab_flash_lite_preview`.
describe("Antigravity MITM model handling", () => {
  const ag = MITM_TOOLS.antigravity;

  it("flags the out-of-box agent/Default model mandatory", () => {
    expect(ag.defaultModels.find((m) => m.id === "gemini-3.5-flash-low")?.mandatory).toBe(true);
  });

  it("leaves models not proven auto-sent optional", () => {
    for (const id of ["gemini-3-flash-agent", "gemini-3.1-pro-low", "claude-sonnet-4-6", "gpt-oss-120b-medium"]) {
      expect(ag.defaultModels.find((m) => m.id === id)?.mandatory).toBeFalsy();
    }
  });

  // Tab-autocomplete is latency-critical inline completion — it must passthrough natively,
  // never get re-routed onto a chat-model mapping by the broad `flash` pattern.
  it.each(["tab_jump_flash_lite_preview", "tab_flash_lite_preview"])(
    "excludes tab-autocomplete model '%s' from re-routing",
    (id) => {
      expect((MODEL_NO_MAP.antigravity || []).some((re) => re.test(id))).toBe(true);
    }
  );

  it("does not exclude real agent models from re-routing", () => {
    for (const id of ["gemini-3.5-flash-low", "gemini-3-flash-agent", "claude-sonnet-4-6"]) {
      expect((MODEL_NO_MAP.antigravity || []).some((re) => re.test(id))).toBe(false);
    }
  });
});

// AN IMAGE REQUEST CANNOT BE SERVED BY A CHAT MODEL.
//
// The image model posts to :generateContent on the same intercepted host as a
// chat turn, so it reaches the dispatcher identically. It has no alias key —
// `modelAliases` above carries only the chat models — so exact and prefix lookup
// both miss and the broad `flash` pattern in MODEL_PATTERNS claimed it for
// gemini-3-flash-agent. The IDE asked for an image and got a text model that
// cannot return inlineData.
//
// The registry is the source of `kind`, so this reads it rather than naming the
// id: a renamed or added image model is covered without editing this file.
describe("Antigravity MITM image-model routing", () => {
  const noMap = (id) => (MODEL_NO_MAP.antigravity || []).some((re) => re.test(id));
  const models = antigravityRegistry.models;

  it("has an image model to protect, which is what makes this suite meaningful", () => {
    expect(models.some((m) => m.kind === "image")).toBe(true);
  });

  it("passes every image-kind model through untouched", () => {
    for (const model of models.filter((m) => m.kind === "image")) {
      expect(noMap(model.id), `${model.id} must never be re-routed`).toBe(true);
    }
  });

  it("still re-routes every chat model", () => {
    for (const model of models.filter((m) => m.kind !== "image")) {
      expect(noMap(model.id), `${model.id} must stay routable`).toBe(false);
    }
  });

  it("covers the aspect-ratio suffix the image handler appends to the model name", () => {
    // open-sse/handlers/imageProviders/antigravity.js encodes body.size into the
    // model id as a `-WxH` suffix, so the id on the wire is not the registry id.
    for (const id of ["gemini-3.1-flash-image-16x9", "gemini-3.1-flash-image-1024x768"]) {
      expect(noMap(id)).toBe(true);
    }
  });
});
