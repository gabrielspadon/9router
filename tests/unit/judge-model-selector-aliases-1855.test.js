// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ModelSelectModal from "../../src/shared/components/ModelSelectModal.js";

// #1855 "Model custom không hiện để chọn trong judge fussion" — a custom model
// can be added to a combo but is not offered as that combo's fusion judge. The
// selector fetches combos, provider nodes, custom models and disabled models
// itself, but took model aliases from a prop; the judge picker (and three other
// call sites) never passed one, so alias-registered models were invisible there.
const ALIAS_MODEL = "my-custom-model";

const ROUTES = {
  "/api/models/alias": () => ({ aliases: { [ALIAS_MODEL]: `anthropic/${ALIAS_MODEL}` } }),
  "/api/combos": () => ({ combos: [] }),
  "/api/provider-nodes": () => ({ nodes: [] }),
  "/api/models/custom": () => ({ models: [] }),
  "/api/models/disabled": () => ({ disabled: {} }),
  "/api/models": () => ({ models: [] }),
};

let mounted;
let fetchMock;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  fetchMock = vi.fn(async (url) => {
    const path = String(url).split("?")[0];
    const handler = ROUTES[path];
    return {
      ok: Boolean(handler),
      status: handler ? 200 : 404,
      json: async () => (handler ? handler() : {}),
    };
  });
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

async function renderSelector(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <ModelSelectModal
        isOpen
        onClose={() => {}}
        onSelect={() => {}}
        activeProviders={[{ provider: "anthropic", id: "c1" }]}
        title="Select Judge Model"
        {...props}
      />,
    );
  });
  // Let the self-fetch effects settle.
  await act(async () => {});

  mounted = { container, unmount: () => act(() => root.unmount()) };
  return container;
}

// Each option button carries the model name plus its capability badges, so the
// name is a prefix of the label rather than the whole of it.
const offers = (container, modelName) =>
  [...container.querySelectorAll("button")].some((b) =>
    b.textContent.trim().startsWith(modelName),
  );

const requestedPaths = () =>
  fetchMock.mock.calls.map(([url]) => String(url).split("?")[0]);

describe("ModelSelectModal without a modelAliases prop (#1855)", () => {
  it("offers an alias-registered model when the caller passes no aliases", async () => {
    const container = await renderSelector();

    expect(requestedPaths()).toContain("/api/models/alias");
    expect(offers(container, ALIAS_MODEL)).toBe(true);
  });

  it("leaves a caller that supplies aliases in control", async () => {
    const container = await renderSelector({ modelAliases: {} });

    expect(requestedPaths()).not.toContain("/api/models/alias");
    expect(offers(container, ALIAS_MODEL)).toBe(false);
  });
});
