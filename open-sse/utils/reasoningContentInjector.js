// Some thinking-mode providers (DeepSeek, Kimi, MiniMax, ...) require reasoning_content
// to be echoed back on assistant messages. Clients in OpenAI format don't send it,
// so we inject a non-empty placeholder to satisfy upstream validation.
import { PROVIDERS } from "../config/providers.js";
import { FORMATS } from "../translator/formats.js";

const PLACEHOLDER = " ";

// Provider-level rules derive from registry transport.reasoningInject (single source)
// Xiaomi's OpenAI-compatible endpoints enforce the same follow-up history
// contract, but do not currently carry transport reasoningInject metadata.
const COMPATIBILITY_PROVIDER_RULES = {
  "xiaomi-mimo": { scope: "all" },
  "xiaomi-tokenplan": { scope: "all" },
};

const providerRuleFor = (provider, targetFormat) => (
  PROVIDERS[provider]?.reasoningInject
  || (targetFormat === FORMATS.OPENAI ? COMPATIBILITY_PROVIDER_RULES[provider] : undefined)
);

// Model-level rules: matched by predicate against model id
const MODEL_RULES = [
  { match: m => /^kimi-/i.test(m || ""), scope: "toolCalls" },
  { match: m => /deepseek/i.test(m || ""), scope: "all" }
];

const DEEPSEEK_V4_PRO = "deepseek-v4-pro";
const DEEPSEEK_V4_PRO_ALIASES = {
  [`${DEEPSEEK_V4_PRO}-max`]: {
    thinkingType: "enabled",
    reasoningEffort: "max"
  },
  [`${DEEPSEEK_V4_PRO}-none`]: {
    thinkingType: "disabled",
    reasoningEffort: null
  }
};

function shouldInject(message, scope) {
  if (message?.role !== "assistant") return false;
  const rc = message.reasoning_content;
  if (typeof rc === "string" && rc.length > 0) return false;
  if (scope === "toolCalls") return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  return true;
}

function applyRule(body, rule) {
  if (!rule || !body?.messages) return body;
  const messages = body.messages.map(m =>
    shouldInject(m, rule.scope) ? { ...m, reasoning_content: PLACEHOLDER } : m
  );
  return { ...body, messages };
}

function applyDeepSeekV4ProAlias({ provider, model, body }) {
  const alias = DEEPSEEK_V4_PRO_ALIASES[model];
  if (provider !== "deepseek" || !alias || !body) return body;

  const nextBody = {
    ...body,
    model: DEEPSEEK_V4_PRO,
    extra_body: {
      ...(body.extra_body || {}),
      thinking: {
        ...(body.extra_body?.thinking || {}),
        type: alias.thinkingType
      }
    }
  };

  if (alias.reasoningEffort) {
    nextBody.reasoning_effort = alias.reasoningEffort;
  } else {
    delete nextBody.reasoning_effort;
  }

  return nextBody;
}

export function injectReasoningContent({ provider, model, body, targetFormat = FORMATS.OPENAI }) {
  const nextBody = applyDeepSeekV4ProAlias({ provider, model, body });
  // reasoning_content is an OpenAI-dialect message key. A multi-endpoint
  // provider can resolve a non-OpenAI wire for the same account: MiniMax M3
  // declares targetFormat "claude" and lands on /anthropic/v1/messages, where
  // the extra key is rejected on every message it was written to. The rules
  // above are keyed on the provider, not on the endpoint, so gate the injector
  // on the resolved wire (#2705). An unresolved transport keeps the old path.
  if (targetFormat && targetFormat !== FORMATS.OPENAI) return nextBody;
  const providerRule = providerRuleFor(provider, targetFormat);
  const modelRule = MODEL_RULES.find(r => r.match(model));
  const rule = providerRule || modelRule;
  return applyRule(nextBody, rule);
}
