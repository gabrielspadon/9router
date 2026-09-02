import { CLAUDE_API_HEADERS } from "../shared.js";

// The China-region Moonshot platform, sibling to kimi.js exactly as glm-cn.js is
// to glm.js (#2510). The international entry only ever reaches api.kimi.com /
// api.moonshot.ai, so a mainland key had no endpoint at all; this is a separate
// account system and a separate host, not a region flag on the same provider.
// Kimi Code (the OAuth subscription) is international-only, so this entry is
// API-key only and carries no oauth block.
export default {
  id: "kimi-cn",
  priority: 171,
  alias: "kimi-cn",
  display: {
    name: "Kimi (China)",
    icon: "psychology",
    color: "#DC2626",
    textIcon: "KC",
    website: "https://platform.moonshot.cn",
    notice: {
      apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
    },
  },
  category: "apikey",
  transport: {
    // Same reason as the international entry: K3 non-streaming waits for the
    // full inference, so stream upstream and let chatCore rebuild the JSON.
    forceStream: true,
    baseUrl: "https://api.moonshot.cn/v1/chat/completions",
    format: "openai",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  // Multi-endpoint: pick the transport matching the client sourceFormat to skip
  // the lossy double hop, as glm-cn does.
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.moonshot.cn/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://api.moonshot.cn/anthropic/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
  ],
  // Platform (pay-as-you-go) ids only. The Kimi Code subscription ids `k3` and
  // `kimi-for-coding*` belong to the international coding endpoint and have no
  // counterpart here.
  models: [
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { id: "kimi-k2.7-code-highspeed", name: "Kimi K2.7 Code Highspeed" },
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "kimi-k2.5-thinking", name: "Kimi K2.5 Thinking" },
    { id: "kimi-latest", name: "Kimi Latest" },
  ],
};
