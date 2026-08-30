import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transportMocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => transportMocks);

import { handleJsonProxyCore } from "../../open-sse/handlers/jsonProxyCore.js";

const originalFetch = global.fetch;
const credentials = {
  apiKey: "test-secret-token",
  providerSpecificData: {
    connectionProxyEnabled: true,
    connectionProxyUrl: "http://proxy.test:3128",
    connectionNoProxy: "localhost,127.0.0.1",
    vercelRelayUrl: "https://relay.test/egress",
    strictProxy: true,
  },
};
const request = {
  provider: "mistral",
  model: "mistral-ocr-latest",
  kind: "ocr",
  body: { model: "mistral/mistral-ocr-latest", document: { type: "document_url", document_url: "https://example.test/a.pdf" } },
  credentials,
};

beforeEach(() => {
  transportMocks.proxyAwareFetch.mockReset();
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("handleJsonProxyCore transport safety", () => {
  it("uses the selected connection's proxy, relay, no-proxy, and strict-routing settings", async () => {
    transportMocks.proxyAwareFetch.mockResolvedValueOnce(new Response('{"pages":[]}', { status: 200 }));

    const result = await handleJsonProxyCore(request);

    expect(result.success).toBe(true);
    expect(transportMocks.proxyAwareFetch).toHaveBeenCalledWith(
      "https://api.mistral.ai/v1/ocr",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer test-secret-token" }) }),
      credentials.providerSpecificData,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not bypass a strict proxy failure with a direct request", async () => {
    transportMocks.proxyAwareFetch.mockRejectedValueOnce(new Error("Proxy required but failed (strictProxy=true)"));

    const result = await handleJsonProxyCore(request);

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(transportMocks.proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("marks a client-aborted request without classifying the account as unavailable", async () => {
    const controller = new AbortController();
    controller.abort();
    transportMocks.proxyAwareFetch.mockRejectedValueOnce(new DOMException("client disconnected", "AbortError"));

    const result = await handleJsonProxyCore({ ...request, signal: controller.signal });

    expect(result).toMatchObject({ success: false, clientAborted: true });
    expect(result.response.status).toBe(499);
  });

  it("reports a bounded upstream timeout as a retryable gateway timeout", async () => {
    transportMocks.proxyAwareFetch.mockImplementationOnce((_url, options) => new Promise((_, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")), { once: true });
    }));

    const result = await handleJsonProxyCore({ ...request, timeoutMs: 1 });

    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.clientAborted).toBeUndefined();
    expect(transportMocks.proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("classifies a body-phase client cancellation without treating it as an upstream success", async () => {
    const controller = new AbortController();
    transportMocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => {
        controller.abort();
        throw new DOMException("client disconnected", "AbortError");
      },
    });

    const result = await handleJsonProxyCore({ ...request, signal: controller.signal });

    expect(result).toMatchObject({ success: false, clientAborted: true });
    expect(result.response.status).toBe(499);
  });

  it("classifies a body-phase timeout as a retryable gateway timeout", async () => {
    transportMocks.proxyAwareFetch.mockImplementationOnce((_url, options) => Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: () => new Promise((_, reject) => {
        if (options.signal.aborted) {
          reject(new DOMException("timed out", "TimeoutError"));
          return;
        }
        options.signal.addEventListener(
          "abort",
          () => reject(new DOMException("timed out", "TimeoutError")),
          { once: true },
        );
      }),
    }));

    const result = await handleJsonProxyCore({ ...request, timeoutMs: 1 });

    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.clientAborted).toBeUndefined();
  });
});
