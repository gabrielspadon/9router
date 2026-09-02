export default {
  id: "google-pse",
  alias: "gpse",
  display: {
    name: "Google PSE",
    icon: "search",
    color: "#4285F4",
    textIcon: "GP",
    website: "https://programmablesearchengine.google.com",
    notice: {
      apiKeyUrl: "https://programmablesearchengine.google.com/controlpanel/create"
    }
  },
  category: "apikey",
  authType: "apikey",
  // Google PSE needs a search engine id beside the API key. Without it every
  // connection fails its own test with "requires both apiKey and cx", because
  // buildGooglePseRequest reads it from providerSpecificData.cx and the key
  // form had nowhere to put it. See #3402.
  extraFields: [
    {
      key: "cx",
      label: "Search Engine ID (cx)",
      placeholder: "a1b2c3d4e5f6g7h8i",
      help: "From the Programmable Search Engine control panel, Basics, Search engine ID.",
      required: true,
    },
  ],
  serviceKinds: [
    "webSearch"
  ],
  searchConfig: {
    baseUrl: "https://www.googleapis.com/customsearch/v1",
    method: "GET",
    authType: "apikey",
    authHeader: "key",
    costPerQuery: 0.005,
    freeMonthlyQuota: 3000,
    searchTypes: [
      "web",
      "news"
    ],
    defaultMaxResults: 5,
    maxMaxResults: 10,
    timeoutMs: 10000,
    cacheTTLMs: 300000
  }
};
