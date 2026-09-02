import { beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

// OpenAI answers a gpt-5.6-sol request that carries both function tools and a
// reasoning effort with "Function tools with reasoning_effort are not supported
// for gpt-5.6-sol in /v1/chat/completions. Please use /v1/responses instead."
// (#2540). The compatibility override already existed but was keyed to the one
// model id it was written for, gpt-5.6-luna, so every coding client on sol
// failed outright.
const functionTool = () => ({
  type: "function",
  function: { name: "lookup_weather", parameters: { type: "object", properties: {} } },
});

const request = (overrides = {}) => ({
  model: "gpt-5.6-sol",
  messages: [{ role: "user", content: "weather?" }],
  stream: false,
  tools: [functionTool()],
  ...overrides,
});

const sentBody = () => JSON.parse(fetchMock.mock.calls.at(-1)[1].body);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  }));
});

describe("gpt-5.6-sol function-tool reasoning compatibility (#2540)", () => {
  it("forces reasoning_effort:none when function tools are declared", async () => {
    await new DefaultExecutor("openai").execute({
      model: "gpt-5.6-sol",
      body: request({ reasoning_effort: "high" }),
      credentials: { apiKey: "sk-test" },
    });
    expect(sentBody().reasoning_effort).toBe("none");
  });

  it("leaves a sol request without function tools alone", async () => {
    await new DefaultExecutor("openai").execute({
      model: "gpt-5.6-sol",
      body: request({ reasoning_effort: "high", tools: undefined }),
      credentials: { apiKey: "sk-test" },
    });
    expect(sentBody().reasoning_effort).toBe("high");
  });

  it("does not touch the client-facing Responses path, which the upstream told us to use", async () => {
    await new DefaultExecutor("openai").execute({
      model: "gpt-5.6-sol",
      body: request({ reasoning_effort: "high" }),
      sourceFormat: "openai-responses",
      credentials: { apiKey: "sk-test" },
    });
    expect(sentBody().reasoning_effort).toBe("high");
  });

  it("leaves a gpt-5 model the upstream has not rejected alone", async () => {
    // The override is a list of ids OpenAI has actually named in that error, not
    // a gpt-5 pattern: forcing reasoning off for a model that accepts tools and
    // effort together would break a working configuration.
    await new DefaultExecutor("openai").execute({
      model: "gpt-5.3-codex",
      body: request({ model: "gpt-5.3-codex", reasoning_effort: "high" }),
      credentials: { apiKey: "sk-test" },
    });
    expect(sentBody().reasoning_effort).toBe("high");
  });
});
