// @vitest-environment jsdom
//
// Upstream bb3cb43e0 — the API Key row of the three media-provider example cards
// masked the tail with `"•".repeat(Math.min(20, apiKey.length - 8))`. A key
// shorter than the 8-char prefix makes that count negative and String.repeat
// throws RangeError, which takes the whole detail page down on render.
// Fix clamps with Math.max(0, ...). This pins a sub-8-char key rendering.

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 5 chars — shorter than the 8-char prefix slice, so length - 8 is negative.
const SHORT_KEY = "sk_ab";

const ROUTES = {
  "/api/keys": { keys: [{ key: SHORT_KEY, isActive: true }] },
  "/api/tunnel/status": {},
  "/api/providers/client": { connections: [] },
};

let container;
let root;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    return { ok: true, status: 200, json: async () => ROUTES[path] ?? {} };
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderCard(Component, props) {
  await act(async () => {
    root.render(createElement(Component, props));
  });
  return container.textContent;
}

describe("media-provider example cards: short API key mask", () => {
  it("GenericExampleCard renders a sub-8-char key without RangeError", async () => {
    const { GenericExampleCard } = await import(
      "@/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/GenericExampleCard.js"
    );
    const text = await renderCard(GenericExampleCard, { providerId: "openai", kind: "image" });
    expect(text).toContain(SHORT_KEY);
  });

  it("SttExampleCard renders a sub-8-char key without RangeError", async () => {
    const { SttExampleCard } = await import(
      "@/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/SttExampleCard.js"
    );
    const text = await renderCard(SttExampleCard, { providerId: "openai" });
    expect(text).toContain(SHORT_KEY);
  });

  it("TtsExampleCard renders a sub-8-char key without RangeError", async () => {
    const { TtsExampleCard } = await import(
      "@/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/TtsExampleCard.js"
    );
    const text = await renderCard(TtsExampleCard, { providerId: "edge-tts" });
    expect(text).toContain(SHORT_KEY);
  });
});
