// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { EmbeddingExampleCard } from "@/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/EmbeddingExampleCard.js";

let container;
let root;
let fetchMock;

async function mount(providerId) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root.render(<EmbeddingExampleCard providerId={providerId} />);
    await Promise.resolve();
  });
}

function findButton(label) {
  return [...container.querySelectorAll("button")].find((button) => button.textContent.includes(label));
}

describe("NVIDIA E5 embedding input type", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    fetchMock = vi.fn((url) => {
      if (url === "/api/keys") return Promise.resolve({ json: async () => ({ keys: [] }) });
      if (url === "/api/tunnel/status") return Promise.resolve({ json: async () => ({}) });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ object: "list", data: [], usage: { total_tokens: 0 } }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
    }
    container?.remove();
    container = undefined;
    root = undefined;
    vi.unstubAllGlobals();
  });

  it("requires a selected query or passage type and carries it in NVIDIA E5 requests", async () => {
    await mount("nvidia");

    const inputType = container.querySelector('select[name="input_type"]');
    const run = findButton("Run");
    expect(inputType).not.toBeNull();
    expect(inputType.value).toBe("");
    expect([...inputType.options].map((option) => option.value)).toEqual(["", "query", "passage"]);
    expect(run.disabled).toBe(true);

    await act(async () => {
      inputType.value = "passage";
      inputType.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(run.disabled).toBe(false);
    const curl = [...container.querySelectorAll("pre")].find((node) => node.textContent.includes("/v1/embeddings"));
    expect(curl.textContent).toContain('"input_type":"passage"');

    await act(async () => {
      run.click();
      await Promise.resolve();
    });

    const request = fetchMock.mock.calls.find(([url]) => url === "/api/v1/embeddings");
    expect(JSON.parse(request[1].body)).toMatchObject({ input_type: "passage" });
  });

  it("does not add an input type selector to embedding models that do not declare one", async () => {
    await mount("openai");

    expect(container.querySelector('select[name="input_type"]')).toBeNull();
  });
});
