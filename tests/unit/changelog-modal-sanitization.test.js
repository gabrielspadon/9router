// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChangelogModal from "../../src/shared/components/ChangelogModal.js";

let mountedRoot;

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  if (mountedRoot) {
    act(() => mountedRoot.unmount());
    mountedRoot = null;
  }
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("ChangelogModal", () => {
  it("sanitizes remotely fetched Markdown before inserting it as HTML", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      "# Notes\n<script>window.__xss = true</script><img src=x onerror=window.__xss=true><a href=javascript:window.__xss=true>unsafe</a>",
      { status: 200 },
    )));
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;

    const container = document.createElement("div");
    document.body.appendChild(container);
    mountedRoot = createRoot(container);
    await act(async () => {
      mountedRoot.render(<ChangelogModal isOpen onClose={() => {}} />);
    });
    await settle();

    const body = document.querySelector(".changelog-body");
    expect(body).not.toBeNull();
    expect(body.querySelector("script")).toBeNull();
    expect(body.querySelector("img")?.getAttribute("onerror")).toBeNull();
    expect(body.querySelector("a")?.getAttribute("href")).toBeNull();
  });
});
