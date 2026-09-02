const crofAi = {
  id: "crof-ai",
  alias: "crof",
  uiAlias: "crof",
  display: {
    name: "Crof AI",
    icon: "auto_awesome",
    color: "#111827",
    textIcon: "CR",
    website: "https://crof.ai",
    notice: {
      apiKeyUrl: "https://crof.ai/docs",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://crof.ai/v1/chat/completions",
  },
  serviceKinds: ["llm", "imageToText"],
  passthroughModels: true,
};

export default crofAi;
