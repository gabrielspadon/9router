// Unified thinking normalization: extract client intent → apply provider-native format.
// Config-driven: thinking format/limits come from capabilities.js + registry transport,
// never hardcoded per-model here. See .docs/thinking/plan.md MATRIX VI-A.

import { getCapabilitiesForModel } from "../../providers/capabilities.js";
import { getThinkingLevels } from "../../providers/thinkingLevels.js";
import { PROVIDERS } from "../../providers/index.js";
import {
  LEVEL_TO_BUDGET,
  budgetToLevel,
  effortToBudget,
  effortToThinkingLevel,
} from "./thinking.js";

// Map a target wire-format to its native thinking format (when capability has none).
const FORMAT_TO_NATIVE = {
  openai: "openai",
  "openai-responses": "openai",
  "openai-response": "openai",
  codex: "openai",
  claude: "claude-budget",
  gemini: "gemini-budget",
  "gemini-cli": "gemini-budget",
  vertex: "gemini-budget",
  antigravity: "gemini-budget",
  kiro: "kiro",
  ollama: "ollama",
};

// Strip a trailing thinking suffix "model(value)" → "model" (no-op when absent).
export function stripThinkingSuffix(model) {
  if (typeof model !== "string") return model;
  const m = model.match(/^(.*)\([^()]+\)\s*$/);
  return m ? m[1].trim() : model;
}

// Parse model-name suffix "model(value)" → { cleanModel, override }.
// value: level name (high) | number (8192) | auto | none. null override when absent.
export function parseSuffix(model) {
  if (typeof model !== "string") return { cleanModel: model, override: null };
  const m = model.match(/^(.*)\(([^()]+)\)\s*$/);
  if (!m) return { cleanModel: model, override: null };
  const cleanModel = m[1].trim();
  const raw = m[2].trim().toLowerCase();
  if (raw === "none" || raw === "off")
    return { cleanModel, override: { mode: "none" } };
  if (raw === "auto") return { cleanModel, override: { mode: "auto" } };
  if (raw === "ultra")
    return { cleanModel, override: { mode: "level", level: raw } };
  if (/^\d+$/.test(raw))
    return { cleanModel, override: { mode: "budget", budget: Number(raw) } };
  if (LEVEL_TO_BUDGET[raw] !== undefined)
    return { cleanModel, override: { mode: "level", level: raw } };
  return { cleanModel, override: null };
}

// Extract unified thinking intent from a request body (post-translation, mixed shapes).
// Returns { mode, budget?, level? } or null when no thinking intent present.
export function extractThinking(body) {
  if (!body || typeof body !== "object") return null;

  // Claude output_config.effort (explicit) — priority over adaptive thinking
  const oc = body.output_config?.effort;
  if (typeof oc === "string" && oc) {
    const e = oc.toLowerCase();
    if (e === "none" || e === "off") return { mode: "none" };
    if (e === "auto") return { mode: "auto" };
    return { mode: "level", level: e };
  }

  // OpenAI chat / Responses shape. Parsed up front, decided below: zai sends an
  // effort alongside thinking:{type:"enabled"}, which on its own maps to
  // mode:auto and would discard the level the client asked for. A disabled
  // marker or an explicit budget is more specific and still wins, which is what
  // keeps a provider-level default from overriding either (#2927).
  const effort =
    body.reasoning_effort ??
    (typeof body.reasoning === "object" ? body.reasoning?.effort : null);
  let effortIntent = null;
  if (typeof effort === "string" && effort) {
    const e = effort.toLowerCase();
    effortIntent =
      e === "none" || e === "off"
        ? { mode: "none" }
        : e === "auto"
          ? { mode: "auto" }
          : { mode: "level", level: e };
  }

  // Claude shape
  const t = body.thinking;
  if (t && typeof t === "object") {
    if (t.type === "disabled") return { mode: "none" };
    if (t.type === "adaptive" || t.type === "enabled") {
      const budget = Number(t.budget_tokens);
      if (Number.isFinite(budget) && budget > 0)
        return { mode: "budget", budget };
      return effortIntent || { mode: "auto" };
    }
  }

  // Ollama shape — `think` at top level (boolean or string low/medium/high/max)
  if (body.think !== undefined) {
    const tv = body.think;
    if (tv === false) return { mode: "none" };
    if (tv === true) return { mode: "auto" };
    if (typeof tv === "string") {
      const e = tv.toLowerCase().trim();
      if (e === "none" || e === "off" || e === "false") return { mode: "none" };
      if (e === "auto" || e === "true") return { mode: "auto" };
      if (
        e === "minimal" ||
        e === "low" ||
        e === "medium" ||
        e === "high" ||
        e === "max" ||
        e === "xhigh"
      ) {
        return { mode: "level", level: e === "xhigh" ? "max" : e };
      }
      if (e) return { mode: "level", level: e };
    }
    // Numeric or other truthy → auto, falsy → none
    if (tv) return { mode: "auto" };
    return { mode: "none" };
  }

  if (effortIntent) return effortIntent;

  // Gemini shape (top-level, generationConfig, or request envelope)
  const tc =
    body.thinkingConfig ||
    body.generationConfig?.thinkingConfig ||
    body.request?.generationConfig?.thinkingConfig;
  if (tc && typeof tc === "object") {
    if (typeof tc.thinkingLevel === "string")
      return { mode: "level", level: tc.thinkingLevel.toLowerCase() };
    const tb = Number(tc.thinkingBudget);
    if (Number.isFinite(tb)) {
      if (tb === 0) return { mode: "none" };
      if (tb < 0) return { mode: "auto" };
      return { mode: "budget", budget: tb };
    }
  }

  // Qwen shape
  if (body.enable_thinking === false) return { mode: "none" };
  if (body.enable_thinking === true) {
    const tb = Number(body.thinking_budget);
    if (Number.isFinite(tb) && tb > 0) return { mode: "budget", budget: tb };
    return { mode: "auto" };
  }

  return null;
}

// Capture thinking intent from a body. Alias of extractThinking, named for clarity
// at the call-site where intent is snapshotted before format translation.
export const captureThinking = extractThinking;

// A custom OpenAI-compatible endpoint speaks OpenAI's wire, whatever its model
// ids happen to look like. Model-name capability lookup does not know that: a
// user pointing an openai-compatible node at a gateway serving "qwen3.7-plus"
// got the qwen NATIVE fields, enable_thinking and thinking_budget, and a strict
// gateway answered 400 on both (#2752). The same reasoning the registry already
// applies to hosted gateways with an explicit provider-level thinkingFormat,
// except these nodes are user-created and have no registry entry to carry one.
function isOpenAICompatibleNode(provider) {
  return typeof provider === "string" && provider.startsWith("openai-compatible-");
}

// Resolve thinking format: provider override > compatible wire > capability >
// derive(targetFormat).
function resolveFormat(targetFormat, model, provider) {
  const providerFmt = provider ? PROVIDERS[provider]?.thinkingFormat : null;
  if (providerFmt) return providerFmt;
  if (isOpenAICompatibleNode(provider)) return "openai";
  const caps = getCapabilitiesForModel(provider, model);
  if (caps.thinkingFormat) return caps.thinkingFormat;
  return FORMAT_TO_NATIVE[targetFormat] || "openai";
}

// Convert unified config to a budget number (for budget-based formats).
function toBudget(cfg, range) {
  let budget;
  if (cfg.mode === "budget") budget = cfg.budget;
  else if (cfg.mode === "level") budget = effortToBudget(cfg.level);
  else if (cfg.mode === "auto") return -1;
  if (!Number.isFinite(budget)) return undefined;
  if (range) {
    if (range.min != null && budget < range.min) budget = range.min;
    if (range.max != null && budget > range.max) budget = range.max;
  }
  return budget;
}

// Convert unified config to a discrete level string.
function toLevel(cfg) {
  if (cfg.mode === "level") return cfg.level;
  if (cfg.mode === "budget") return budgetToLevel(cfg.budget) || "medium";
  if (cfg.mode === "auto") return "auto";
  return null;
}

// Ascending effort. "ultra" sits above "max" so a request for it clamps down
// through max first, which is the behaviour this function already had.
const OPENAI_LEVEL_LADDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

function normalizeOpenAILevel(level, supportedLevels) {
  // No declared set means no basis to clamp against; leave the caller's value.
  if (!Array.isArray(supportedLevels) || supportedLevels.length === 0) return level;
  if (supportedLevels.includes(level)) return level;

  const idx = OPENAI_LEVEL_LADDER.indexOf(level);
  if (idx < 0) return level; // not a level this ladder knows; not ours to rewrite

  // Clamp DOWN to the highest level the provider actually accepts. The previous
  // version examined only "max" and "ultra" and then returned "xhigh"
  // unconditionally, without checking the set contained it. No provider shipping
  // today reaches that: every thinkingFormat "openai" level set includes xhigh,
  // and the none/low/medium/high providers (qwen, step, hunyuan) use their own
  // formats and never arrive here. So this is hardening, not a fix for an
  // observed failure — it makes emitting a level outside the declared set
  // structurally impossible rather than merely unlikely.
  for (let i = idx - 1; i >= 0; i--) {
    if (supportedLevels.includes(OPENAI_LEVEL_LADDER[i])) return OPENAI_LEVEL_LADDER[i];
  }
  // Nothing at or below is supported, so take the lowest on offer rather than
  // sending a value that is certain to be refused.
  for (const candidate of OPENAI_LEVEL_LADDER) {
    if (supportedLevels.includes(candidate)) return candidate;
  }
  return level;
}

function toGeminiThinkingLevel(cfg) {
  const raw = cfg.mode === "auto" ? "high" : toLevel(cfg) || "high";
  return effortToThinkingLevel(raw);
}

function toKimiReasoningEffort(cfg) {
  const level = toLevel(cfg);
  if (level === "auto") return "high";
  if (level === "minimal") return "low";
  if (level === "xhigh") return "max";
  if (["low", "medium", "high", "max"].includes(level)) return level;
  return null;
}

function toOllamaThink(cfg, supportedLevels) {
  if (!cfg) return null;
  if (cfg.mode === "auto") return true;
  const level = toLevel(cfg);
  if (!level || level === "auto") return true;
  if (level === "minimal") return "low";
  if (level === "xhigh") return "max";
  if (["low", "medium", "high", "max"].includes(level)) {
    // gpt-oss only supports low/medium/high — clamp max→high when unsupported
    if (level === "max" && supportedLevels && !supportedLevels.includes("max"))
      return "high";
    return level;
  }
  return "medium";
}

const GEMINI_LEVEL_OUTPUT_FLOOR = {
  minimal: 4096,
  low: 8192,
  medium: 16384,
  high: 65535,
};

function geminiBudgetOutputFloor(budget) {
  if (budget === -1) return 32768;
  if (!Number.isFinite(budget)) return 32768;
  if (budget <= 1024) return 8192;
  if (budget <= 8192) return 16384;
  if (budget <= 24576) return 32768;
  return 65535;
}

function geminiLevelOutputFloor(level) {
  return GEMINI_LEVEL_OUTPUT_FLOOR[level] || GEMINI_LEVEL_OUTPUT_FLOOR.high;
}

// Gemini nests thinkingConfig under generationConfig. gemini-cli / antigravity wrap
// the whole request in a { request: { generationConfig } } envelope — target the
// envelope's generationConfig when present, else the top-level one.
function getGeminiGenerationConfig(body) {
  if (body.request && typeof body.request === "object") {
    if (
      !body.request.generationConfig ||
      typeof body.request.generationConfig !== "object"
    ) {
      body.request.generationConfig = {};
    }
    return body.request.generationConfig;
  }
  if (!body.generationConfig || typeof body.generationConfig !== "object") {
    body.generationConfig = {};
  }
  return body.generationConfig;
}

function setGeminiThinking(body, tc) {
  const gc = getGeminiGenerationConfig(body);
  gc.thinkingConfig = tc;
}

function ensureGeminiOutputFloor(body, floor, caps) {
  const cap = Number.isFinite(caps?.maxOutput) ? caps.maxOutput : floor;
  const target = Math.min(floor, cap);
  const gc = getGeminiGenerationConfig(body);
  const current = Number(gc.maxOutputTokens);
  if (!Number.isFinite(current) || current < target) {
    gc.maxOutputTokens = target;
  }
}

// Strip every known thinking field from a body (used before re-applying / when unsupported).
function stripAll(body) {
  delete body.thinking;
  delete body.reasoning_effort;
  delete body.reasoning;
  delete body.thinkingConfig;
  delete body.enable_thinking;
  delete body.thinking_budget;
  delete body.output_config;
  delete body.think;
  if (body.generationConfig) delete body.generationConfig.thinkingConfig;
  if (body.request?.generationConfig)
    delete body.request.generationConfig.thinkingConfig;
}

// Apply unified thinking config to body in the resolved provider-native format.
function applyFormat(fmt, body, cfg, caps, supportedLevels) {
  const none = cfg.mode === "none";
  const canDisable = caps.thinkingCanDisable !== false;
  // Model cannot disable thinking → clamp "none" to minimal effort instead.
  const eff = none && !canDisable ? { mode: "level", level: "minimal" } : cfg;

  switch (fmt) {
    case "openai": {
      if (none && canDisable) {
        body.reasoning_effort = "none";
        break;
      }
      const level = toLevel(eff);
      if (level)
        body.reasoning_effort = normalizeOpenAILevel(level, supportedLevels);
      break;
    }
    case "claude-adaptive": {
      if (none && canDisable) {
        body.thinking = { type: "disabled" };
        break;
      }
      // output_config.effort alone does NOT turn thinking on: Anthropic requires
      // an explicit thinking:{type:"adaptive"} on Opus 4.6/4.7/4.8 and Sonnet 4.6
      // ("thinking is off unless you explicitly set it"), and Anthropic-compatible
      // shims (e.g. GitHub Copilot /v1/messages) default thinking off even for
      // Sonnet 5. Send both fields — the documented adaptive-thinking shape.
      body.thinking = { type: "adaptive" };
      const level = toLevel(eff);
      // output_config.effort only accepts low|medium|high|xhigh — omit it in
      // auto mode (thinking is already on; upstream picks its own level). #2894
      if (level && level !== "auto") body.output_config = { effort: level === "xhigh" ? "high" : level };
      break;
    }
    case "claude-budget": {
      if (none && canDisable) {
        body.thinking = { type: "disabled" };
        break;
      }
      const budget = toBudget(eff, caps.thinkingRange);
      // Anthropic requires budget_tokens whenever type === "enabled" — auto mode
      // (-1) gets 10000, matching normalizeClaudePassthrough's downgrade. #2894
      body.thinking =
        budget === -1
          ? { type: "enabled", budget_tokens: 10000 }
          : { type: "enabled", budget_tokens: budget || 8192 };
      break;
    }
    case "gemini-level": {
      const level = none ? "minimal" : toGeminiThinkingLevel(eff);
      setGeminiThinking(body, {
        thinkingLevel: level,
        includeThoughts: level !== "minimal",
      });
      ensureGeminiOutputFloor(body, geminiLevelOutputFloor(level), caps);
      break;
    }
    case "gemini-budget": {
      if (none && canDisable) {
        setGeminiThinking(body, { thinkingBudget: 0, includeThoughts: false });
        break;
      }
      const budget = toBudget(eff, caps.thinkingRange);
      setGeminiThinking(body, {
        thinkingBudget: budget ?? -1,
        includeThoughts: true,
      });
      ensureGeminiOutputFloor(
        body,
        geminiBudgetOutputFloor(budget ?? -1),
        caps,
      );
      break;
    }
    case "zai": {
      // Z.ai ignores thinking.disabled → must use enable_thinking:false to turn off.
      if (none && canDisable) {
        body.enable_thinking = false;
        delete body.thinking;
        break;
      }
      body.thinking = { type: "enabled" };
      // z.ai reads reasoning_effort only from GLM-5.2 onward; older GLM ignores
      // it, so send it only where capabilities declare thinkingEffortSupported.
      // GLM-5.3 accepts exactly low|high|max and errors on anything else, and
      // 5.2 maps its wider set onto the same three server-side, so one mapping
      // serves both.
      if (caps.thinkingEffortSupported) {
        const zaiLvl = toLevel(eff);
        body.reasoning_effort =
          zaiLvl === "low" || zaiLvl === "minimal"
            ? "low"
            : zaiLvl === "high" || zaiLvl === "medium"
              ? "high"
              : "max";
      }
      break;
    }
    case "qwen": {
      if (none && canDisable) {
        body.enable_thinking = false;
        break;
      }
      body.enable_thinking = true;
      const budget = toBudget(eff, caps.thinkingRange);
      if (Number.isFinite(budget) && budget > 0) body.thinking_budget = budget;
      break;
    }
    case "deepseek": {
      if (none && canDisable) {
        body.thinking = { type: "disabled" };
        break;
      }
      body.thinking = { type: "enabled" };
      // DeepSeek: low/medium→high, xhigh/max→max. The top of that ladder is
      // honoured only when the route actually offers it: an aggregator can serve
      // deepseek models on a gateway that rejects "max", and this branch used to
      // emit it regardless of the resolved level set, so narrowing the set alone
      // changed nothing (#2455).
      const level = toLevel(eff);
      const maxOffered = !Array.isArray(supportedLevels) || supportedLevels.includes("max");
      body.reasoning_effort =
        (level === "xhigh" || level === "max") && maxOffered ? "max" : "high";
      break;
    }
    case "kimi": {
      if (none && canDisable) {
        body.thinking = { type: "disabled" };
        break;
      }
      const effort = toKimiReasoningEffort(eff);
      if (effort) body.reasoning_effort = effort;
      break;
    }
    case "opencode": {
      // opencode zen gateway enum on OpenAI-style reasoning_effort:
      // none|low|medium|high|max. Verified live: xhigh/minimal/auto → 400
      // "[1210] Invalid API parameter"; omitted field → upstream default.
      if (none && canDisable) {
        body.reasoning_effort = "none";
        break;
      }
      const level = toLevel(eff);
      if (!level || level === "auto") break;
      body.reasoning_effort =
        level === "xhigh" || level === "ultra"
          ? "max"
          : level === "minimal"
            ? "low"
            : level;
      break;
    }
    case "ollama": {
      if (none && canDisable) {
        body.think = false;
        break;
      }
      const out = toOllamaThink(eff, supportedLevels);
      if (out !== null && out !== undefined) body.think = out;
      break;
    }
    case "minimax": {
      // M3 adaptive; M2.x cannot disable (handled via canDisable clamp).
      body.thinking = { type: none && canDisable ? "disabled" : "adaptive" };
      break;
    }
    case "hunyuan": {
      if (none && canDisable) {
        body.thinking = { type: "disabled" };
        break;
      }
      const budget = toBudget(eff, caps.thinkingRange);
      body.thinking =
        budget === -1
          ? { type: "enabled" }
          : { type: "enabled", budget_tokens: budget || 8192 };
      break;
    }
    case "step": {
      if (none && canDisable) break;
      const level = toLevel(eff);
      if (level)
        body.reasoning_effort =
          level === "xhigh" || level === "max" ? "high" : level;
      break;
    }
    case "tokenrouter": {
      // TokenRouter's reasoning_effort enum is low/medium/high/xhigh/max — it rejects
      // "none"/"auto" with a 400 and supports "max" natively (no clamp like openai).
      // "none" → omit the field so the upstream default applies; pass levels through.
      if (none || eff.mode === "auto") break;
      const level = toLevel(eff);
      if (level) body.reasoning_effort = level;
      break;
    }
    case "nous": {
      // Nous's first-party client omits `reasoning` when disabled and sends a
      // nested object when enabled. The API does not advertise top-level
      // `reasoning_effort`, so never forward that OpenAI-specific field.
      if (none && canDisable) break;
      const level = eff.mode === "auto" ? "medium" : toLevel(eff);
      body.reasoning = {
        enabled: true,
        ...(level ? { effort: level } : {}),
      };
      break;
    }
    case "meta": {
      // Meta Muse Spark reasons by default and rejects "none" (HTTP 400). With
      // thinkingCanDisable:false the "none" mode is clamped to "minimal" above
      // (see eff). A literal "none" level (non-UI path) is omitted so the
      // upstream default applies. No "max" — clamp max/ultra to "xhigh".
      const level = toLevel(eff);
      if (level === "none") break;
      if (level) body.reasoning_effort = normalizeOpenAILevel(level, ["xhigh", "high", "medium", "low", "minimal"]);
      break;
    }
    case "kiro":
      // Kiro thinking handled via system-tag injection in openai-to-kiro.js; no body field here.
      break;
    default:
      break;
  }
}

// Public entry: normalize thinking for the resolved target format.
// Mutates and returns body. No-op when model has no reasoning capability.
// `intent` is a pre-captured config (from captureThinking on the original body);
// falls back to extracting from the current body when omitted.
export function applyThinking(
  targetFormat,
  model,
  body,
  provider = null,
  intent = undefined,
) {
  if (!body || typeof body !== "object") return body;

  const { cleanModel, override } = parseSuffix(model);
  const cfg = override || intent || extractThinking(body);
  const caps = getCapabilitiesForModel(provider, cleanModel);

  // Model cannot reason → strip any stray thinking fields.
  if (!caps.reasoning) {
    stripAll(body);
    return body;
  }
  if (!cfg) return body;

  const responsesReasoning =
    targetFormat === "openai-responses" &&
    body.reasoning &&
    typeof body.reasoning === "object" &&
    !Array.isArray(body.reasoning)
      ? { ...body.reasoning }
      : null;
  const fmt = resolveFormat(targetFormat, cleanModel, provider);
  const supportedLevels = getThinkingLevels(provider, cleanModel);
  stripAll(body);
  applyFormat(fmt, body, cfg, caps, supportedLevels);
  if (targetFormat === "openai-responses" && body.reasoning_effort) {
    const effort = body.reasoning_effort;
    delete body.reasoning_effort;
    body.reasoning = { ...responsesReasoning, effort };
  }
  return body;
}
