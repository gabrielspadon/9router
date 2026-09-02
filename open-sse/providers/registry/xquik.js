export default {
  id: "xquik",
  alias: "xquik",
  display: {
    name: "Xquik",
    icon: "tag",
    color: "#5C3327",
    textIcon: "XQ",
    website: "https://docs.xquik.com/api-reference/x/search-tweets",
    notice: {
      apiKeyUrl: "https://xquik.com",
      text: "Searches public X posts. Billing uses 1 Xquik credit per returned post.",
    },
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: ["webSearch"],
  searchConfig: {
    baseUrl: "https://xquik.com/api/v1/x/tweets/search",
    // Probed by the key-validation route instead of baseUrl: a search costs
    // credits, so validating a key must not run one.
    validateUrl: "https://xquik.com/api/v1/credits",
    method: "GET",
    authType: "apikey",
    authHeader: "x-api-key",
    searchTypes: ["x"],
    defaultMaxResults: 5,
    maxMaxResults: 100,
    timeoutMs: 10000,
    cacheTTLMs: 60000,
    // Billed per returned post, not per query — no costPerQuery.
    creditsPerResult: 1,
  },
};
