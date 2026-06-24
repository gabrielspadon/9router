import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../open-sse/translator/request/claude-to-openai.js", () => ({
  claudeToOpenAIRequest: vi.fn((_model, body) => ({ messages: body.messages || [] })),
}));

vi.mock("../../open-sse/translator/request/openai-to-claude.js", () => ({
  openaiToClaudeRequest: vi.fn((_model, body) => ({ messages: body.messages || [] })),
}));

import { compressWithHeadroom, formatHeadroomLog } from "../../open-sse/rtk/headroom.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("compressWithHeadroom", () => {
  it("no-ops when disabled", async () => {
    global.fetch = vi.fn();
    const body = { messages: [{ role: "user", content: "hello" }] };

    const stats = await compressWithHeadroom(body, { enabled: false, url: "http://localhost:8787" });

    expect(stats).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(body.messages[0].content).toBe("hello");
  });

  it("compresses messages in-place", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "user", content: "short" }],
      tokens_before: 100,
      tokens_after: 20,
      tokens_saved: 80,
    }), { status: 200 }));
    const body = { messages: [{ role: "user", content: "long" }] };

    const stats = await compressWithHeadroom(body, { enabled: true, url: "http://headroom:8787/", model: "gpt-4o" });

    expect(body.messages[0].content).toBe("short");
    expect(stats.tokens_saved).toBe(80);
    expect(global.fetch).toHaveBeenCalledWith("http://headroom:8787/v1/compress", expect.objectContaining({ method: "POST" }));
  });

  it("preserves image_url blocks when compressing GPT-5 vision messages", async () => {
    global.fetch = vi.fn(async (_url, init) => {
      const payload = JSON.parse(init.body);
      expect(payload.model).toBe("gpt-5.5");
      expect(payload.messages[0].content.some((block) => block.type === "image_url")).toBe(true);
      return new Response(JSON.stringify({
        messages: payload.messages,
        tokens_before: 120,
        tokens_after: 120,
        tokens_saved: 0,
      }), { status: 200 });
    });
    const body = { messages: [{ role: "user", content: [
      { type: "text", text: "Describe this image." },
      { type: "image_url", image_url: { url: "https://example.com/image.png" } },
    ] }] };

    const stats = await compressWithHeadroom(body, { enabled: true, url: "http://headroom:8787", model: "gpt-5.5" });

    expect(stats.tokens_saved).toBe(0);
    expect(body.messages[0].content.some((block) => block.type === "image_url")).toBe(true);
  });

  it("compresses responses input in-place", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "user", content: "short" }],
    }), { status: 200 }));
    const body = { input: [{ role: "user", content: "long" }] };

    await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" });

    expect(body.input[0].content).toBe("short");
  });

  it("fails open on bad response", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "bad" }), { status: 500 }));
    const body = { messages: [{ role: "user", content: "long" }] };

    const stats = await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" });

    expect(stats).toBeNull();
    expect(body.messages[0].content).toBe("long");
  });

  it("skips unknown shapes", async () => {
    global.fetch = vi.fn();
    const body = { contents: [{ parts: [{ text: "long" }] }] };

    const stats = await compressWithHeadroom(body, { enabled: true, url: "http://localhost:8787" });

    expect(stats).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("formatHeadroomLog", () => {
  it("formats savings", () => {
    expect(formatHeadroomLog({ tokens_before: 100, tokens_after: 25, tokens_saved: 75 }))
      .toBe("saved 75 tokens / 100 (75.0%) after=25");
  });
});
