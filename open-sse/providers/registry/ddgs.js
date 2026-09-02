// Self-hosted DDGS metasearch API server (deedy5/ddgs): `pip install ddgs[api]`
// then `ddgs api`. No auth, default port 4479. Aggregates bing, brave,
// duckduckgo, google, grokipedia, mojeek, startpage, yandex, yahoo, wikipedia.
import { DDGS_URL } from "../../config/runtimeConfig.js";

export default {
  id: "ddgs",
  alias: "ddgs",
  display: {
    name: "DDGS",
    icon: "travel_explore",
    color: "#DE5833",
    textIcon: "DG",
    website: "https://github.com/deedy5/ddgs"
  },
  category: "freeTier",
  authType: "none",
  serviceKinds: [
    "webSearch"
  ],
  noAuth: true,
  searchConfig: {
    baseUrl: DDGS_URL,
    method: "POST",
    authType: "none",
    authHeader: "none",
    costPerQuery: 0,
    freeMonthlyQuota: 999999,
    searchTypes: [
      "web",
      "news"
    ],
    defaultMaxResults: 5,
    maxMaxResults: 50,
    timeoutMs: 10000,
    cacheTTLMs: 180000
  }
};
