const sumopod = {
  id: "sumopod",
  alias: "sp",
  uiAlias: "sp",
  display: {
    name: "SumoPod",
    icon: "cloud",
    color: "#2F66E8",
    textIcon: "SP",
    website: "https://sumopod.com",
    notice: {
      text: "OpenAI-compatible AI gateway. Requires a SumoPod API key.",
      apiKeyUrl: "https://sumopod.com/dashboard/ai/keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://ai.sumopod.com/v1/chat/completions",
    validateUrl: "https://ai.sumopod.com/v1/models",
  },
  models: [
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "gemini/gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  ],
  passthroughModels: true,
};

export default sumopod;
