// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://router.example/dashboard"}
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import OAuthModal from "../../src/shared/components/OAuthModal.js";
import { get } from "../../src/shared/utils/api.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

let mounted;

function mountOAuthModal(provider, providerInfo = { name: provider }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onSuccess = vi.fn();
  const onClose = vi.fn();
  const render = (isOpen = true) => act(() => {
    root.render(
      <OAuthModal
        isOpen={isOpen}
        provider={provider}
        providerInfo={providerInfo}
        onSuccess={onSuccess}
        onClose={onClose}
      />,
    );
  });
  render();
  mounted = {
    container,
    onClose,
    render,
    unmount: () => act(() => root.unmount()),
  };
  return mounted;
}

async function settleOAuthModal() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function setInputValue(input, value) {
  await act(async () => {
    const previousValue = input.value;
    input.value = value;
    input._valueTracker?.setValue(previousValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function codexAuthorizeResponse() {
  return new Response(JSON.stringify({
    state: "codex-state",
    codeVerifier: "codex-verifier",
    authUrl: "https://auth.openai.example/authorize",
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("shared API response handling", () => {
  it("returns parsed JSON response bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(get("/api/status")).resolves.toEqual({ ok: true });
  });

  it("treats an empty successful response as an empty object", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));

    await expect(get("/api/status")).resolves.toEqual({});
  });

  it("does not expose a non-JSON failure body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      "<html>upstream diagnostic with token=secret</html>",
      { status: 502, statusText: "Bad Gateway", headers: { "Content-Type": "text/html" } },
    )));

    const error = await get("/api/oauth/xai/authorize").catch((caught) => caught);

    expect(error).toMatchObject({
      message: "Request failed (502 Bad Gateway)",
      status: 502,
    });
    expect(error.message).not.toMatch(/token=secret|<html>/i);
  });

  it("preserves structured JSON API errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "API key is required" }),
      { status: 400, statusText: "Bad Request", headers: { "Content-Type": "application/json" } },
    )));

    await expect(get("/api/keys")).rejects.toMatchObject({
      message: "API key is required",
      status: 400,
      data: { error: "API key is required" },
    });
  });

  it("handles null JSON failure bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("null", {
      status: 503,
      statusText: "Service Unavailable",
      headers: { "Content-Type": "application/json" },
    })));

    await expect(get("/api/oauth/xai/authorize")).rejects.toMatchObject({
      message: "Request failed (503 Service Unavailable)",
      status: 503,
      data: null,
    });
  });

  it("uses the safe response parser for IDE detection", async () => {
    const ideResponse = new Response(JSON.stringify({ installed: true, path: "/Applications/Trae" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    Object.defineProperty(ideResponse, "json", {
      value: vi.fn(() => { throw new Error("legacy JSON reader called"); }),
    });
    vi.stubGlobal("fetch", vi.fn((url) => {
      if (String(url).endsWith("/ide-status")) return Promise.resolve(ideResponse);
      return Promise.resolve(new Response("", { status: 502, statusText: "Bad Gateway" }));
    }));

    const { container } = mountOAuthModal("trae", { name: "Trae" });
    await settleOAuthModal();
    const pasteToken = [...container.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Paste token"));
    act(() => pasteToken.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(ideResponse.json).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Trae IDE not detected.");
  });

  it("shows a structured OAuth JSON error without reading raw response text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "OAuth configuration rejected" }),
      { status: 400, statusText: "Bad Request", headers: { "Content-Type": "application/json" } },
    )));

    const { container } = mountOAuthModal("xai", { name: "Grok Build" });
    await settleOAuthModal();

    expect(container.textContent).toContain("OAuth configuration rejected");
  });

  it("blocks the popup when callback registration returns a non-JSON failure", async () => {
    vi.stubGlobal("fetch", vi.fn((url) => {
      const request = String(url);
      if (request.endsWith("/ide-status")) {
        return Promise.resolve(new Response(JSON.stringify({ installed: true }), { status: 200 }));
      }
      if (request.includes("/start-proxy")) {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          callbackUrl: "http://127.0.0.1:47123/callback",
        }), { status: 200 }));
      }
      if (request.includes("/authorize")) {
        return Promise.resolve(new Response(JSON.stringify({
          state: "state-1",
          redirectUri: "http://127.0.0.1:47123/callback",
          authUrl: "https://login.example.test/authorize",
        }), { status: 200 }));
      }
      if (request.includes("/register-session")) {
        return Promise.resolve(new Response(
          "<html>upstream diagnostic with token=secret</html>",
          { status: 502, statusText: "Bad Gateway", headers: { "Content-Type": "text/html" } },
        ));
      }
      throw new Error(`Unexpected request: ${request}`);
    }));
    const popup = vi.spyOn(window, "open").mockReturnValue({});

    const { container } = mountOAuthModal("trae", { name: "Trae" });
    await settleOAuthModal();

    expect(popup).not.toHaveBeenCalled();
    expect(container.textContent).toContain("OAuth callback registration failed (502 Bad Gateway)");
    expect(container.textContent).not.toMatch(/token=secret|<html>/i);
  });

  it("uses manual Codex OAuth on a hosted dashboard without controlling the local proxy", async () => {
    const fetchMock = vi.fn((url) => {
      if (String(url).includes("/authorize")) return Promise.resolve(codexAuthorizeResponse());
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const popup = vi.spyOn(window, "open").mockReturnValue({});

    const { container } = mountOAuthModal("codex", { name: "Codex" });
    await settleOAuthModal();

    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContainEqual(expect.stringContaining("/start-proxy"));
    expect(popup).toHaveBeenCalledWith(
      "https://auth.openai.example/authorize",
      "_blank",
      "noopener,noreferrer",
    );
    expect(container.querySelector("input")).not.toBeNull();

    const cancel = [...container.querySelectorAll("button")].find((button) => button.textContent === "Cancel");
    act(() => cancel.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContainEqual(expect.stringContaining("/stop-proxy"));
  });

  it("drops a hosted pasted Codex callback whose code state does not match the flow", async () => {
    const fetchMock = vi.fn((url) => {
      if (String(url).includes("/authorize")) return Promise.resolve(codexAuthorizeResponse());
      if (String(url).includes("/exchange")) return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "open").mockReturnValue({});

    const { container } = mountOAuthModal("codex", { name: "Codex" });
    await settleOAuthModal();
    const callbackInput = container.querySelector("input:not([readonly])");
    await setInputValue(
      callbackInput,
      "http://localhost:1455/auth/callback?code=oauth-code&state=forged-state",
    );
    expect(callbackInput.value).toContain("forged-state");
    const connect = [...container.querySelectorAll("button")].find((button) => button.textContent === "Connect");
    expect(connect.disabled).toBe(false);
    await act(async () => {
      connect.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContainEqual(expect.stringContaining("/exchange"));
    expect(container.textContent).not.toContain("Connection Failed");
    expect(container.textContent).toContain("Step 2: Paste the callback URL here");
  });

  it("drops a hosted pasted Codex callback error whose state does not match the flow", async () => {
    const fetchMock = vi.fn((url) => {
      if (String(url).includes("/authorize")) return Promise.resolve(codexAuthorizeResponse());
      if (String(url).includes("/exchange")) return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "open").mockReturnValue({});

    const { container } = mountOAuthModal("codex", { name: "Codex" });
    await settleOAuthModal();
    await setInputValue(
      container.querySelector("input:not([readonly])"),
      "http://localhost:1455/auth/callback?error=access_denied&state=forged-state",
    );
    const connect = [...container.querySelectorAll("button")].find((button) => button.textContent === "Connect");
    await act(async () => {
      connect.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContainEqual(expect.stringContaining("/exchange"));
    expect(container.textContent).not.toContain("Connection Failed");
    expect(container.textContent).toContain("Step 2: Paste the callback URL here");
  });

  it("preserves the raw Codex JWT manual fallback without a callback state", async () => {
    const rawJwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjb2RleCJ9.signature";
    const fetchMock = vi.fn((url) => {
      if (String(url).includes("/authorize")) return Promise.resolve(codexAuthorizeResponse());
      if (String(url).includes("/exchange")) return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "open").mockReturnValue({});

    const { container } = mountOAuthModal("codex", { name: "Codex" });
    await settleOAuthModal();
    await setInputValue(container.querySelector("input:not([readonly])"), rawJwt);
    const connect = [...container.querySelectorAll("button")].find((button) => button.textContent === "Connect");
    await act(async () => {
      connect.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const [, exchangeOptions] = fetchMock.mock.calls.find(([url]) => String(url).includes("/exchange"));
    expect(JSON.parse(exchangeOptions.body)).toMatchObject({ code: rawJwt, state: null });
  });
});
