const ERROR_INFO = "type.googleapis.com/google.rpc.ErrorInfo";
const HELP = "type.googleapis.com/google.rpc.Help";
const REASON = "VALIDATION_REQUIRED";
const MAX_URL_BYTES = 8192;
const ALLOWED_DOMAINS = new Set([
  "cloudcode-pa.googleapis.com",
  "staging-cloudcode-pa.googleapis.com",
  "autopush-cloudcode-pa.googleapis.com",
]);
const ALLOWED_SOURCES = new Set(["loadCodeAssist", "onboardUser", "usage", "chat"]);
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const GOOGLE_URL_RE = /https:\/\/accounts\.google\.com[^\s"'<>\\]*/g;

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

function isActionUrl(value) {
  try {
    return new URL(value).pathname !== "/";
  } catch {
    return false;
  }
}

export function validateAntigravityVerificationUrl(candidate) {
  if (typeof candidate !== "string" || candidate !== candidate.trim() || CONTROL_RE.test(candidate)) return null;
  if (byteLength(candidate) < 1 || byteLength(candidate) > MAX_URL_BYTES) return null;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "accounts.google.com") return null;
  if (parsed.port || parsed.username || parsed.password) return null;
  return byteLength(parsed.href) <= MAX_URL_BYTES ? parsed.href : null;
}

function classifyLoadCodeAssist(status, payload, source) {
  if (source !== "loadCodeAssist" || status < 200 || status >= 300 || payload?.currentTier) return null;
  if (!Array.isArray(payload?.ineligibleTiers)) return null;

  const tier = payload.ineligibleTiers.find((candidate) =>
    candidate?.reasonCode === REASON && Object.hasOwn(candidate, "validationUrl"),
  );
  if (!tier) return null;
  const url = validateAntigravityVerificationUrl(tier.validationUrl);
  return url && isActionUrl(url)
    ? { kind: "antigravity_validation_required", url, source }
    : null;
}

function classifyRpcError(status, payload, source) {
  if (status !== 403 || !payload?.error || (Object.hasOwn(payload.error, "code") && payload.error.code !== 403)) return null;
  const details = payload.error.details;
  if (!Array.isArray(details)) return null;

  const info = details.find((detail) => detail?.["@type"] === ERROR_INFO);
  if (!info || !ALLOWED_DOMAINS.has(info.domain) || info.reason !== REASON) return null;

  const help = details.find((detail) => detail?.["@type"] === HELP);
  const selected = help && Array.isArray(help.links) && help.links.length > 0
    ? help.links[0]?.url
    : info.metadata?.validation_link;
  const url = validateAntigravityVerificationUrl(selected);
  return url && isActionUrl(url)
    ? { kind: "antigravity_validation_required", url, source }
    : null;
}

export function classifyAntigravityValidation({ status, payload, source } = {}) {
  if (!ALLOWED_SOURCES.has(source)) return null;
  return classifyLoadCodeAssist(status, payload, source) || classifyRpcError(status, payload, source);
}

function redactObject(value) {
  if (Array.isArray(value)) {
    const validationDetails = value.some((item) =>
      item?.["@type"] === ERROR_INFO && item.reason === REASON,
    );
    return value.map((item) => {
      const redacted = redactObject(item);
      if (!validationDetails || item?.["@type"] !== HELP || !Array.isArray(redacted?.links)) return redacted;
      return {
        ...redacted,
        links: redacted.links.map((link) =>
          link && typeof link === "object" && Object.hasOwn(link, "url")
            ? { ...link, url: "[REDACTED]" }
            : link,
        ),
      };
    });
  }
  if (!value || typeof value !== "object") return value;

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = ["validationUrl", "validation_url", "validation_link"].includes(key)
      ? "[REDACTED]"
      : redactObject(child);
  }
  return result;
}

export function redactAntigravityValidationText(text) {
  const input = String(text ?? "");
  let redacted = input;
  try {
    redacted = JSON.stringify(redactObject(JSON.parse(input)));
  } catch {
    // Keep raw diagnostics available after URL tokens are removed below.
  }
  return redacted.replace(GOOGLE_URL_RE, "[REDACTED]");
}
