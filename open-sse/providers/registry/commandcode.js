export default {
  id: "commandcode",
  priority: 100,
  alias: "commandcode",
  aliases: [
    "cmc",
  ],
  uiAlias: "cmc",
  display: {
    name: "Command Code",
    icon: "smart_toy",
    color: "#000000",
    textIcon: "CC",
    website: "https://commandcode.ai",
    notice: {
      text: "Use a CommandCode Provider API key from commandcode.ai/studio. Every plan except Go has API access.",
      apiKeyUrl: "https://commandcode.ai/studio",
    },
  },
  category: "apikey",
  // The documented Provider API, not the CLI's own endpoint (#1528). CommandCode
  // asked the project to stop calling `/alpha/generate` while impersonating their
  // CLI (`x-command-code-version` / `x-cli-environment` / a per-request
  // `x-session-id`), which is a terms-of-service violation on their side and an
  // API they can change without notice on ours. `/provider/v1/chat/completions`
  // is plain OpenAI Chat Completions with a Bearer key, so the default executor
  // and no translator hop serve it.
  transport: {
    baseUrl: "https://api.commandcode.ai/provider/v1/chat/completions",
    validateUrl: "https://api.commandcode.ai/provider/v1/models",
  },
  models: [
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek/deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision Exp" },
    { id: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision Exp", upstreamModelId: "deepseek/deepseek-v4-flash-vision-exp" },
    { id: "moonshotai/Kimi-K2.6", name: "Kimi K2.6" },
    { id: "moonshotai/Kimi-K2.5", name: "Kimi K2.5" },
    { id: "zai-org/GLM-5.2", name: "GLM 5.2" },
    { id: "zai-org/GLM-5.1", name: "GLM 5.1" },
    { id: "zai-org/GLM-5", name: "GLM 5" },
    { id: "MiniMaxAI/MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "MiniMaxAI/MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "Qwen/Qwen3.6-Max-Preview", name: "Qwen 3.6 Max Preview" },
    { id: "Qwen/Qwen3.6-Plus", name: "Qwen 3.6 Plus" },
    { id: "stepfun/Step-3.5-Flash", name: "Step 3.5 Flash" },
  ],
};
