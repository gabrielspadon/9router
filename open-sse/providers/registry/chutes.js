export default {
  id: "chutes",
  priority: 70,
  alias: "chutes",
  aliases: [
    "ch",
  ],
  uiAlias: "ch",
  display: {
    name: "Chutes AI",
    icon: "water_drop",
    color: "#ffffffff",
    textIcon: "CH",
    website: "https://chutes.ai",
    notice: {
      apiKeyUrl: "https://chutes.ai/app/api",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://llm.chutes.ai/v1/chat/completions",
    validateUrl: "https://llm.chutes.ai/v1/models",
  },
  // Issue #983: Chutes exposes a public OpenAI-compatible catalog at this URL,
  // but the provider previously had no static models and required every model
  // id to be entered by hand. "openai-list" is the existing generic id/name
  // mapper in suggested-models/filters.js; the Chutes response is a plain
  // OpenAI-shaped /v1/models list, so no Chutes-specific filter is needed for
  // the id/name projection the issue asks for. passthroughModels lets any id
  // the picker offers, or a user types, reach the upstream untouched.
  modelsFetcher: { url: "https://llm.chutes.ai/v1/models", type: "openai-list" },
  passthroughModels: true,
};
