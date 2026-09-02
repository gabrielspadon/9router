const modelscope = {
  id: "modelscope",
  alias: "ms",
  display: {
    name: "ModelScope",
    icon: "smart_toy",
    color: "#624AFF",
    textIcon: "MS",
    website: "https://modelscope.cn",
    notice: {
      text: "Free API Inference: 2,000 calls/day total and 200 calls/model/day. Requires a verified linked Alibaba Cloud account.",
      apiKeyUrl: "https://modelscope.cn/my/myaccesstoken",
    },
  },
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api-inference.modelscope.cn/v1/chat/completions",
  },
  models: [
    { id: "deepseek-ai/DeepSeek-V4-Pro", name: "DeepSeek V4 Pro" },
    { id: "ZhipuAI/GLM-5.2", name: "GLM 5.2" },
  ],
};

export default modelscope;
