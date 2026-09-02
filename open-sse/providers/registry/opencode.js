export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://opencode.ai",
    // Single OpenAI-compatible gateway for every model (claude/gpt/gemini/... ids
    // included) → one reasoning_effort enum; overrides per-model caps format.
    thinkingFormat: "opencode",
    headers: {
      "x-opencode-client": "desktop",
    },
    noAuth: true,
    // #1173: opencode's own non-streaming branch is broken for some models. The
    // reporter observed qwen3.6-plus answering /v1/chat/completions with a raw
    // Claude-shaped body on stream:false, and qwen3.6-plus-free returning a 500
    // outright, while stream:true against the same endpoint works. Forcing the
    // stream puts JSON clients on the branch that works: handleForcedSSEToJson
    // already converts the SSE back into a Chat Completion for them, so nothing
    // downstream has to detect and repair a response whose shape does not match
    // the endpoint it arrived on. Model names are the reporter's observation,
    // not a published contract.
    forceStream: true,
  },
  models: [],
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
