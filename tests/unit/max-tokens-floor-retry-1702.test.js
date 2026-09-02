// Issue #1702: an OpenAI-compatible upstream answered
//   {"error":{"message":"max_tokens must be greater than 2", ...}}
// and the request died there, because the client's small max_tokens went
// upstream untouched. Raising every small limit up front would change what the
// caller deliberately asked for; reacting to the refusal only changes a request
// the upstream has already rejected, and only by the floor it named itself.
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { DefaultExecutor } = await import("../../open-sse/executors/default.js");

const creds = { apiKey: "k", providerSpecificData: { baseUrl: "https://chat.example/v1" } };
const floorRefusal = (n = 2) =>
  new Response(
    JSON.stringify({ error: { message: `max_tokens must be greater than ${n} (request id: 1)`, type: "api_error" } }),
    { status: 500 },
  );
const ok = () => new Response(JSON.stringify({ choices: [] }), { status: 200 });

const run = (body) =>
  new DefaultExecutor("openai-compatible-test").execute({
    model: "deepseek-v4-flash",
    body,
    stream: false,
    credentials: creds,
  });

const sentMaxTokens = (call) => JSON.parse(call[1].body).max_tokens;

beforeEach(() => fetchMock.mockReset());

describe("max_tokens floor refusal is retried once (#1702)", () => {
  it("retries at the floor the upstream named and returns that response", async () => {
    fetchMock.mockResolvedValueOnce(floorRefusal(2)).mockResolvedValueOnce(ok());

    const out = await run({ messages: [], max_tokens: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentMaxTokens(fetchMock.mock.calls[0])).toBe(1);
    expect(sentMaxTokens(fetchMock.mock.calls[1])).toBe(3); // "greater than 2"
    expect(out.response.status).toBe(200);
  });

  it("reads 'at least N' as N rather than N+1", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "max_tokens must be at least 16" } }), { status: 400 }),
      )
      .mockResolvedValueOnce(ok());

    await run({ messages: [], max_tokens: 4 });

    expect(sentMaxTokens(fetchMock.mock.calls[1])).toBe(16);
  });

  it("does not mutate the caller's body", async () => {
    fetchMock.mockResolvedValueOnce(floorRefusal(2)).mockResolvedValueOnce(ok());
    const body = { messages: [], max_tokens: 1 };

    await run(body);

    expect(body.max_tokens).toBe(1);
  });

  it("retries once only — a second refusal is returned as is", async () => {
    fetchMock.mockResolvedValue(floorRefusal(2));

    const out = await run({ messages: [], max_tokens: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.response.status).toBe(500);
  });

  it("leaves an unrelated failure alone", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "insufficient balance" } }), { status: 402 }),
    );

    const out = await run({ messages: [], max_tokens: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.response.status).toBe(402);
  });

  it("leaves a successful response alone, body unread", async () => {
    fetchMock.mockResolvedValueOnce(ok());

    const out = await run({ messages: [], max_tokens: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.response.bodyUsed).toBe(false);
    await expect(out.response.json()).resolves.toEqual({ choices: [] });
  });

  it("does not retry when the request already met the floor", async () => {
    // Same complaint, but the caller sent more than it asks for: the refusal is
    // about something else and a retry would only burn a second upstream call.
    fetchMock.mockResolvedValueOnce(floorRefusal(2));

    await run({ messages: [], max_tokens: 4096 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the client sent no max_tokens", async () => {
    fetchMock.mockResolvedValueOnce(floorRefusal(2));

    await run({ messages: [] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
