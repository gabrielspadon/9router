export default {
  id: "xai",
  priority: 280,
  alias: "xai",
  // Bare Grok ids belong to the xAI API when they are present in its catalog.
  // Subscription routes remain explicit as gcli/* and grok-web/*.
  bareModelPrefixes: ["grok-"],
  display: {
    name: "xAI (Grok)",
    icon: "auto_awesome",
    color: "#1DA1F2",
    textIcon: "XA",
    website: "https://x.ai",
    notice: {
      apiKeyUrl: "https://console.x.ai",
    },
  },
  category: "oauth",
  authModes: [
    "oauth",
    "apikey",
  ],
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.x.ai/v1/chat/completions",
    validateUrl: "https://api.x.ai/v1/models",
    responsesUrl: "https://api.x.ai/v1/responses",
    clientId: "b1a00492-073a-47ea-816f-4c329264a828",
    tokenUrl: "https://auth.x.ai/oauth2/token",
    refreshUrl: "https://auth.x.ai/oauth2/token",
  },
  models: [
    { id: "grok-4.6", name: "Grok 4.6" },
    { id: "grok-4.5", name: "Grok 4.5" },
    { id: "grok-build-0.1", name: "Grok Build 0.1" },
    { id: "grok-4.3", name: "Grok 4.3" },
    { id: "grok-4.20-0309-reasoning", name: "Grok 4.20 Reasoning" },
    { id: "grok-4.20-0309-non-reasoning", name: "Grok 4.20 Non-Reasoning" },
    { id: "grok-4.20-multi-agent-0309", name: "Grok 4.20 Multi-Agent" },
    { id: "grok-4", name: "Grok 4" },
    { id: "grok-4-fast-reasoning", name: "Grok 4 Fast Reasoning" },
    { id: "grok-code-fast-1", name: "Grok Code Fast" },
    { id: "grok-3", name: "Grok 3" },
    { id: "grok-2-image-1212", name: "Grok 2 Image", params: ["n","response_format"], kind: "image" },
    { id: "grok-imagine-image", name: "Grok Imagine Image", params: ["n","response_format"], kind: "image" },
    { id: "grok-imagine-image-quality", name: "Grok Imagine Image Quality", params: ["n","response_format"], kind: "image" },
    { id: "grok-imagine-image-2.0", name: "Grok Imagine Image 2.0", params: ["n","response_format"], kind: "image" },
    { id: "grok-imagine-video", name: "Grok Imagine Video", params: ["duration","aspect_ratio","resolution"], kind: "video" },
    { id: "grok-imagine-video-1.5", name: "Grok Imagine Video 1.5", params: ["duration","aspect_ratio","resolution"], kind: "video" },
  ],
  serviceKinds: ["llm","imageToText","webSearch","image","video"],
  imageConfig: { baseUrl: "https://api.x.ai/v1/images/generations", bodyFields: ["model","prompt","n","response_format"] },
  // Image-to-image editing (issue #1608). xAI's edits endpoint takes a JSON
  // body, not multipart like OpenAI's images.edit() — {model, prompt,
  // image:{url|data-uri, type:"image_url"}} — and its own REST reference
  // (docs.x.ai/developers/model-capabilities/images/editing, checked
  // 2026-08-31) documents only grok-imagine-image-2.0 as edit-capable; the
  // other three image models here are documented generations-only. No route
  // or handler consumes this yet (open-sse/handlers/imageProviders/xai.js and
  // src/app/api/v1/images/edits/route.js do not exist), so this declares the
  // provider-side contract for whichever lane builds that endpoint.
  imageEditConfig: {
    baseUrl: "https://api.x.ai/v1/images/edits",
    bodyFields: ["model","prompt","image"],
    models: ["grok-imagine-image-2.0"],
  },
  // Async video jobs (POST returns { request_id }, GET polls until done/failed).
  // Docs: https://docs.x.ai/developers/rest-api-reference/inference/videos
  videoConfig: { baseUrl: "https://api.x.ai/v1/videos" },
  searchViaChat: {
    defaultModel: "grok-4.20-reasoning",
    endpoint: "https://api.x.ai/v1/responses",
    pricingUrl: "https://x.ai/api#pricing",
  },
};
