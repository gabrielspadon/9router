export default {
  id: "cline",
  priority: 80,
  alias: "cl",
  uiAlias: "cl",
  display: {
    name: "Cline",
    icon: "smart_toy",
    color: "#5B9BD5",
    textIcon: "CL",
    website: "https://cline.bot",
    notice: {
      signupUrl: "https://cline.bot",
    },
  },
  category: "oauth",
  transport: {
    baseUrl: "https://api.cline.bot/api/v1/chat/completions",
    headers: {
      "HTTP-Referer": "https://cline.bot",
      "X-Title": "Cline",
    },
    tokenUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
      hooks: [
        "clineHeaders",
      ],
    },
  },
  models: [
    { id: "moonshotai/kimi-k3", name: "kimi-k3" },
    { id: "anthropic/claude-opus-5", name: "claude-opus-5" },
    { id: "x-ai/grok-4.5", name: "grok-4.5" },
    { id: "openai/gpt-5.6-sol", name: "gpt-5.6-sol" },
    { id: "cline-free/longcat-2.0", name: "LongCat-2.0" },
    { id: "z-ai/glm-5.3-flash", name: "glm-5.3-flash" },
    { id: "deepseek/deepseek-v4-flash", name: "deepseek-v4-flash" },
    { id: "poolside/laguna-s-2.1:free", name: "laguna-s-2.1:free" },
  ],
  oauth: {
    appBaseUrl: "https://app.cline.bot",
    apiBaseUrl: "https://api.cline.bot",
    authorizeUrl: "https://api.cline.bot/api/v1/auth/authorize",
    tokenExchangeUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
  },
};
