const x5lab = {
  id: "x5lab",
  alias: "x5l",
  uiAlias: "x5l",
  display: {
    name: "X5Lab",
    icon: "science",
    color: "#D7263D",
    textIcon: "X5",
    website: "https://x5lab.dev",
    notice: {
      text: "OpenAI-compatible AI gateway. Requires an X5Lab API key.",
      apiKeyUrl: "https://x5lab.dev/docs",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.x5lab.dev/v1/chat/completions",
    validateUrl: "https://api.x5lab.dev/v1/models",
  },
  models: [
    { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
    { id: "gpt-5.5", name: "GPT-5.5" },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "glm-5", name: "GLM-5" },
    { id: "qwen3-coder-next", name: "Qwen3 Coder Next" },
  ],
  passthroughModels: true,
};

export default x5lab;
