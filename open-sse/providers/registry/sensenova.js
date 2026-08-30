const sensenova = {
  id: "sensenova",
  priority: 75,
  alias: "sensenova",
  aliases: ["sn"],
  uiAlias: "sn",
  display: {
    name: "SenseNova",
    icon: "cloud",
    color: "#1A73E8",
    textIcon: "SN",
    website: "https://www.sensenova.cn/token-plan",
    notice: {
      text: "Free public beta: 60,000 general points and 60,000 Flash-Lite points per rolling 5 hours.",
      apiKeyUrl: "https://platform.sensenova.cn/console/keys",
    },
  },
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://token.sensenova.cn/v1/chat/completions",
    validateUrl: "https://token.sensenova.cn/v1/models",
  },
  models: [
    { id: "sensenova-6.8-flash-lite", name: "SenseNova 6.8 Flash Lite" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "glm-5.2", name: "GLM-5.2" },
  ],
  serviceKinds: ["llm"],
};

export default sensenova;
