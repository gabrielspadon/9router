const gitlawbOpenGateway = {
  id: "gitlawb-opengateway",
  alias: "ogw",
  uiAlias: "ogw",
  display: {
    name: "Gitlawb OpenGateway",
    icon: "router",
    color: "#111827",
    textIcon: "OG",
    website: "https://gitlawb.com/opengateway",
    notice: {
      text: "OpenAI-compatible gateway. Requires an OpenGateway API key.",
      apiKeyUrl: "https://gitlawb.com/opengateway/keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://opengateway.gitlawb.com/v1/chat/completions",
    validateUrl: "https://opengateway.gitlawb.com/v1/credits",
  },
  models: [
    { id: "auto", name: "Auto (smart routing)" },
    { id: "xiaomi/mimo-v2.5-pro", name: "MiMo V2.5-Pro" },
    { id: "xiaomi/mimo-v2.5", name: "MiMo V2.5" },
  ],
  modelsFetcher: { url: "https://opengateway.gitlawb.com/v1/models", type: "openai-list" },
  passthroughModels: true,
};

export default gitlawbOpenGateway;
