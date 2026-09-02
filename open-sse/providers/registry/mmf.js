// Xiaomi ended the free MiMo channel ("MiMo free API service has ended"), same as
// the mimo-free.js entry this duplicates (see there). #3035: the endpoint 403s
// every direct call and 400s "Unsupported model" through the gateway, so the
// catalog no longer lists a model id upstream permanently rejects. baseUrl/noAuth
// stay as-is (pinned by the providers baseline, and dead regardless of value).
export default {
  id: "mmf",
  hidden: true,
  priority: 200,
  display: {
    name: "MMF",
    icon: "hub",
    color: "#6366F1",
    textIcon: "MF",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.xiaomimimo.com/api/free-ai/openai/chat",
    noAuth: true,
  },
  models: [],
};
