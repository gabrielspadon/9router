// Xiaomi ended the free MiMo channel ("MiMo free API service has ended").
// Hidden until/unless a replacement (OAuth MiMo Platform) is wired.
export default {
  id: "mimo-free",
  hidden: true,
  priority: 50,
  hasFree: true,
  alias: "mmf",
  uiAlias: "mmf",
  display: {
    name: "MiMo Code Free",
    icon: "smart_toy",
    color: "#FF6900",
    textIcon: "MF",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://api.xiaomimimo.com/api/free-ai/openai/chat",
    noAuth: true,
  },
  // Emptied for the same reason the header gives and the mmf.js twin now does:
  // the channel is gone, so advertising mimo-auto only offers a model the
  // upstream answers with 403 "Illegal access" directly and 400 "Unsupported
  // model" through the gateway (#3035). The fetcher below still runs, so a
  // revived channel repopulates this on its own, and passthroughModels means
  // anyone who wants to try an id by hand still can.
  models: [],
  modelsFetcher: { url: "https://models.dev/api.json", type: "mimo-free" },
  passthroughModels: true,
};
