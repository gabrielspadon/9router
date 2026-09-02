import { PROVIDERS } from "../config/providers.js";
import { OPENAI_COMPAT_BASE, ANTHROPIC_COMPAT_BASE } from "../providers/shared.js";

const OPENAI_COMPATIBLE_PREFIX = "openai-compatible-";
const OPENAI_COMPATIBLE_DEFAULTS = {
  baseUrl: OPENAI_COMPAT_BASE,
};

const ANTHROPIC_COMPATIBLE_PREFIX = "anthropic-compatible-";
const ANTHROPIC_COMPATIBLE_DEFAULTS = {
  baseUrl: ANTHROPIC_COMPAT_BASE,
};

function isOpenAICompatible(provider) {
  return typeof provider === "string" && provider.startsWith(OPENAI_COMPATIBLE_PREFIX);
}

function isAnthropicCompatible(provider) {
  return typeof provider === "string" && provider.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
}

// Resolve the API type (chat vs responses) for an openai-compatible node.
// The stored apiType on the connection's providerSpecificData (kept in sync with
// the node on create/update) is authoritative. Falls back to the node ID
// substring for legacy nodes created before apiType was persisted — their IDs
// embed the type: openai-compatible-<chat|responses>-<uuid>.
export function resolveOpenAICompatibleApiType(provider, credentials = null) {
  const stored = credentials?.providerSpecificData?.apiType;
  if (stored === "chat" || stored === "responses") return stored;
  return typeof provider === "string" && provider.includes("responses") ? "responses" : "chat";
}

// Detect request format from body structure
export function detectFormat(body) {
  // OpenAI Responses API: has input (array or string) instead of messages[]
  // The Responses API accepts both input as array and input as a plain string
  if (body.input && (Array.isArray(body.input) || typeof body.input === "string") && !body.messages) {
    return "openai-responses";
  }

  // Antigravity format: Gemini wrapped in body.request
  if (body.request?.contents && body.userAgent === "antigravity") {
    return "antigravity";
  }

  // Gemini format: has contents array
  if (body.contents && Array.isArray(body.contents)) {
    return "gemini";
  }

  // OpenAI-specific indicators (check BEFORE Claude)
  // These fields are OpenAI-specific and never appear in Claude format
  if (
    body.stream_options ||           // OpenAI streaming options
    body.response_format ||           // JSON mode, etc.
    body.logprobs !== undefined ||    // Log probabilities
    body.top_logprobs !== undefined ||
    body.n !== undefined ||           // Number of completions
    body.presence_penalty !== undefined ||  // Penalties
    body.frequency_penalty !== undefined ||
    body.logit_bias ||                // Token biasing
    body.user                         // User identifier
  ) {
    return "openai";
  }

  // Claude format: messages with content as array of objects with type
  // Claude requires content to be array with specific structure
  if (body.messages && Array.isArray(body.messages)) {
    const firstMsg = body.messages[0];
    
    // If content is array, check if it follows Claude structure
    if (firstMsg?.content && Array.isArray(firstMsg.content)) {
      const firstContent = firstMsg.content[0];
      
      // Claude format has specific types: text, image, tool_use, tool_result
      // OpenAI multimodal has: text, image_url (note the difference)
      if (firstContent?.type === "text" && !body.model?.includes("/")) {
        // Could be Claude or OpenAI multimodal
        // Check for Claude-specific fields
        if (body.system || body.anthropic_version) {
          return "claude";
        }
        // Check if image format is Claude (source.type) vs OpenAI (image_url.url)
        const hasClaudeImage = firstMsg.content.some(c => 
          c.type === "image" && c.source?.type === "base64"
        );
        const hasOpenAIImage = firstMsg.content.some(c => 
          c.type === "image_url" && c.image_url?.url
        );
        if (hasClaudeImage) return "claude";
        if (hasOpenAIImage) return "openai";
        
        // If still unclear, check for tool format
        const hasClaudeTool = firstMsg.content.some(c => 
          c.type === "tool_use" || c.type === "tool_result"
        );
        if (hasClaudeTool) return "claude";
      }
    }
    
    // If content is string, it's likely OpenAI (Claude also supports this)
    // Check for other Claude-specific indicators
    if (body.system !== undefined || body.anthropic_version) {
      return "claude";
    }
  }

  // Default to OpenAI format
  return "openai";
}

// Get provider config (internal — no external runtime consumer)
function getProviderConfig(provider, credentials = null) {
  if (isOpenAICompatible(provider)) {
    const apiType = resolveOpenAICompatibleApiType(provider, credentials);
    return {
      ...PROVIDERS.openai,
      format: apiType === "responses" ? "openai-responses" : "openai",
      baseUrl: OPENAI_COMPATIBLE_DEFAULTS.baseUrl,
    };
  }
  if (isAnthropicCompatible(provider)) {
    return {
      ...PROVIDERS.anthropic, // Use Anthropic defaults (header: x-api-key)
      format: "claude",
      baseUrl: ANTHROPIC_COMPATIBLE_DEFAULTS.baseUrl,
    };
  }
  return PROVIDERS[provider] || PROVIDERS.openai;
}

// Get target format for provider
export function getTargetFormat(provider, credentials = null) {
  if (isOpenAICompatible(provider)) {
    return resolveOpenAICompatibleApiType(provider, credentials) === "responses" ? "openai-responses" : "openai";
  }
  if (isAnthropicCompatible(provider)) {
    return "claude";
  }
  const config = getProviderConfig(provider, credentials);
  return config.format || "openai";
}

// The credential kind a transport can be scoped to. Stored authType values are
// "oauth", "apikey"/"api_key", "access_token" (an OAuth token pasted by hand) and
// "cookie"; an unrecognised one is passed through so it can only match a transport
// that names it. With no authType at all — standalone open-sse callers — the shape
// of the credential decides.
export function credentialAuthMode(credentials) {
  const declared = String(credentials?.authType || "").toLowerCase().replace(/_/g, "");
  if (declared === "accesstoken") return "oauth";
  if (declared) return declared;
  return credentials?.apiKey && !credentials?.accessToken ? "apikey" : "oauth";
}

// A client format the provider declares no transport for — a Responses-API client
// against Kimi, say — fell through to the provider's DEFAULT transport, and for a
// credential-scoped provider that default is the endpoint belonging to the OTHER
// credential kind. So a platform API key landed back on the subscription host that
// answers "please check your API key" with a 401 (#943) — the same failure #2881
// fixed, for the formats it did not declare. Keep the endpoint scoped to the
// credential and let the translator reach it: the resulting target format is the one
// getTargetFormat() already returned on this path, so only the host and the auth
// scheme move. Opt-in exactly as below — a provider whose transports name no
// authModes is untouched, and a credential kind no transport claims still resolves
// to null so the provider default stays in charge.
function authScopedFallback(transports, config, credentials) {
  if (!transports.some(t => Array.isArray(t.authModes))) return null;
  const mode = credentialAuthMode(credentials);
  const scoped = transports.filter(t => t.authModes?.includes(mode));
  if (!scoped.length) return null;
  return scoped.find(t => t.format === config?.format) || scoped[0];
}

// Resolve which transport to use for a provider given the client sourceFormat.
// Multi-endpoint providers (transport.transports[]) pick the entry matching sourceFormat
// to avoid lossy translation; falls back to the default transport when no match.
//
// A transport may also declare `authModes` to opt into credential-scoped selection,
// for the providers that serve an API key and a subscription token from different
// hosts — Kimi's platform API against its Coding endpoint (#2881). Format alone
// cannot separate those two, since both carry the same client format. The opt-in is
// what keeps this narrow: when no entry matching the format declares authModes,
// selection stays the plain first-match it has always been, so a provider that
// declares none behaves exactly as before.
export function resolveTransport(provider, sourceFormat, credentials = null) {
  const config = PROVIDERS[provider];
  const transports = config?.transports || credentials?.providerSpecificData?.transports;
  if (!Array.isArray(transports) || !transports.length) return null;
  const matches = transports.filter(t => t.format === sourceFormat);
  if (!matches.length) return authScopedFallback(transports, config, credentials);
  if (!matches.some(t => Array.isArray(t.authModes))) return matches[0];
  const mode = credentialAuthMode(credentials);
  return (
    matches.find(t => t.authModes?.includes(mode)) ||
    matches.find(t => !t.authModes) ||
    matches[0]
  );
}

// Check if last message is from user
export function isLastMessageFromUser(body) {
  const messages = body.messages || body.contents;
  if (!messages?.length) return true;
  const lastMsg = messages[messages.length - 1];
  return lastMsg?.role === "user";
}

// Check if request has thinking config
export function hasThinkingConfig(body) {
  return !!(body.reasoning_effort || body.thinking?.type === "enabled");
}

// Normalize provider-native thinking config based on last message role.
// OpenAI reasoning_effort is request-level and must survive tool-result turns.
export function normalizeThinkingConfig(body) {
  if (!isLastMessageFromUser(body)) {
    delete body.thinking;
  }
  return body;
}
