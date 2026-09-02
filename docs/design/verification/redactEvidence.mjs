#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Threat model: retained evidence can be read outside the operator boundary.
// Credentials, account identity, connection UUIDs, custom provider-node
// identity/endpoints, connected-provider topology, and live failure detail are
// private. Route paths, control semantics, counts, and audit measurements stay
// visible so before/after capability parity remains reproducible.
const SECRET_KEY = "access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|authorization|proxy[_-]?authorization|cookie|set[_-]?cookie|password|token";
const SECRET_FIELDS = new RegExp(`(["']?)(${SECRET_KEY})\\1(\\s*[:=]\\s*)(["'])([^"']*)\\4`, "gi");
const SECRET_HEADERS = new RegExp(`(^|\\n)(\\s*)(${SECRET_KEY})\\s*:\\s*([^\\r\\n]*)`, "gim");
const SECRET_QUERY = new RegExp(`([?&])(${SECRET_KEY}|code|state)=([^&#\\s"']*)`, "gi");
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
// `sk-` alone covered one vendor. A key is a secret whatever prefix its issuer
// chose, so the common ones are all matched; the trailing group keeps a
// partially-masked key ("sk-abc...wxyz") from publishing its visible tail.
const KEY_PREFIX = "sk|xai|pt|gsk|pk|ghp|gho|ghs|ghu|github_pat|AKIA|ASIA|glpat|xoxb|xoxp|xapp|hf|nvapi|dop_v1|shpat";
// Two shapes, because a real key and a partially-masked key look nothing alike.
// A whole key is long: the 16-character floor keeps a user-chosen label such as
// an API key's display name `sk_tokenproxy (default)` from being reported as the
// key it names. A masked key is short by construction, so it is recognised by
// the mask run itself rather than by length.
const CLIENT_KEY_FRAGMENT = new RegExp(
  `\\b(?:${KEY_PREFIX})[-_][A-Za-z0-9][A-Za-z0-9_-]{15,}`
  + `|\\b(?:${KEY_PREFIX})[-_][A-Za-z0-9][A-Za-z0-9_-]{2,}[*.\\u2022]+[A-Za-z0-9_-]+`,
  "gi");
const PRIVATE_HOST = "localhost|127(?:\\.\\d{1,3}){3}|10(?:\\.\\d{1,3}){3}|192\\.168(?:\\.\\d{1,3}){2}|172\\.(?:1[6-9]|2\\d|3[01])(?:\\.\\d{1,3}){2}|\\[[0-9a-f:]+\\]|[A-Za-z0-9-]+\\.(?:local|lan|internal|home)";
// The scheme is optional in practice: "localhost:20128" in a log line names the
// same protected service as "http://localhost:20128". `0.0.0.0` binds every
// interface and is a local endpoint too.
const LOCAL_HOST_ALT = `${PRIVATE_HOST}|0\\.0\\.0\\.0`;
const LOCAL_ENDPOINT = new RegExp(
  `\\b(?:https?://)?(?:${LOCAL_HOST_ALT})(?::\\d{1,5})(?:/[^\\s<>"']*)?`
  + `|\\bhttps?://(?:${LOCAL_HOST_ALT})(?:/[^\\s<>"']*)?`,
  "gi");
const COUNTED_LIVE_STATUS = /\b\d+\s+(?:connected|error|token expired|rate limited|cooling down|last call failed|not tested|disabled)(?:\s*·\s*(?:auth|429|5xx|net|runtime|err|\d{3}))?\b/gi;
const LIVE_STATUS_PHRASE = /\b(?:token expired|rate limited|cooling down|last call failed|last run failed|refresh failed)\b/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const LIVE_ERROR_FIELD = /^(consoleErrors?|failedRequests?|navError|lastError|error)$/i;

const stableAlias = (kind, value) => {
  const digest = createHash("sha256")
    .update(String(value).trim().toLowerCase())
    .digest("hex")
    .slice(0, 12);
  return `[redacted-${kind}-${digest}]`;
};
const emailPlaceholder = (email) => stableAlias("email", email);
const uuidPlaceholder = (uuid) => stableAlias("connection-id", uuid);
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function addAlias(aliases, kind, value) {
  if (typeof value !== "string" || value.trim().length < 3) return;
  const source = value.trim();
  if (/^\[redacted-/i.test(source)) return;
  aliases.set(source.toLowerCase(), {
    value: source,
    replacement: stableAlias(kind, source),
  });
}

export function buildEvidencePrivacyContext({ connections = [], nodes = [] } = {}) {
  const aliases = new Map();
  const connectedProviders = new Map();

  for (const connection of connections) {
    addAlias(aliases, "connection-id", connection?.id);
    for (const key of ["name", "displayName", "email", "account"]) {
      addAlias(aliases, "connection-label", connection?.[key]);
    }
    addAlias(aliases, "live-error", connection?.lastError);
    for (const [key, value] of Object.entries(connection || {})) {
      if (/proxy|endpoint|baseUrl|host/i.test(key)) addAlias(aliases, "operational-topology", value);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [nestedKey, nestedValue] of Object.entries(value)) {
          if (/proxy|endpoint|baseUrl|url|host|nodeName/i.test(nestedKey)) {
            addAlias(aliases, "operational-topology", nestedValue);
          }
        }
      }
    }
    if (typeof connection?.provider === "string" && connection.provider.trim()) {
      const id = connection.provider.trim();
      connectedProviders.set(id.toLowerCase(), {
        id,
        replacement: stableAlias("connected-provider", id),
      });
    }
  }

  for (const node of nodes) {
    for (const key of ["id", "name", "prefix", "baseUrl", "openaiUrl", "anthropicUrl"]) {
      addAlias(aliases, "provider-node", node?.[key]);
    }
    for (const transport of node?.transports || []) {
      addAlias(aliases, "provider-node", transport?.baseUrl);
    }
  }

  return {
    aliases: [...aliases.values()].sort((a, b) => b.value.length - a.value.length),
    connectedProviders: [...connectedProviders.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function contextAliasMatcher(context) {
  const aliases = context?.aliases || [];
  if (!aliases.length) return null;
  const replacements = new Map(
    aliases.map(({ value, replacement }) => [value.toLowerCase(), replacement]),
  );
  const alternatives = aliases.map(({ value }) => escapeRegExp(value)).join("|");
  return {
    pattern: new RegExp(`(^|[^A-Z0-9_-])(${alternatives})(?=$|[^A-Z0-9_-])`, "gi"),
    replacements,
  };
}

function replaceContextAliases(text, context) {
  const matcher = contextAliasMatcher(context);
  if (!matcher) return text;
  return text.replace(
    matcher.pattern,
    (_, prefix, value) => `${prefix}${matcher.replacements.get(value.toLowerCase())}`,
  );
}

export function redactEvidenceText(text, context = {}) {
  const credentialsRedacted = String(text)
    .replace(SECRET_FIELDS, (_, quote, key, separator, valueQuote) => `${quote}${key}${quote}${separator}${valueQuote}[redacted]${valueQuote}`)
    .replace(SECRET_HEADERS, (_, lineStart, whitespace, key) => `${lineStart}${whitespace}${key}: [redacted]`)
    .replace(SECRET_QUERY, (_, prefix, key) => `${prefix}${key}=[redacted]`)
    .replace(JWT, "[redacted-jwt]")
    .replace(BEARER, "Bearer [redacted]")
    .replace(CLIENT_KEY_FRAGMENT, "[redacted-client-api-key]")
    .replace(LOCAL_ENDPOINT, "[redacted-local-endpoint]");
  return replaceContextAliases(credentialsRedacted, context)
    .replace(COUNTED_LIVE_STATUS, "[redacted-live-status]")
    .replace(LIVE_STATUS_PHRASE, "[redacted-live-status]")
    .replace(EMAIL, emailPlaceholder)
    .replace(UUID, uuidPlaceholder);
}

export function redactEvidenceValue(value, context = {}, fieldName = "") {
  const liveError = LIVE_ERROR_FIELD.test(fieldName);
  if (typeof value === "string") {
    if (liveError && value) return stableAlias("live-error", value);
    return redactEvidenceText(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (liveError && typeof item === "string" && item) return stableAlias("live-error", item);
      return redactEvidenceValue(item, context, fieldName);
    });
  }
  if (value && typeof value === "object") {
    // Evidence keyed BY a secret (a map from connection id, or from an endpoint,
    // to its state) used to pass through whole, because only the values were
    // walked. The key is redacted for content but keeps its own original name
    // for the field-name rules, so `failedRequests` still aliases its entries.
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        redactEvidenceText(key, context),
        redactEvidenceValue(item, context, key),
      ]),
    );
  }
  return value;
}

export function redactInventoryRecords(records, context = {}) {
  return records.map((record) => {
    const redacted = redactEvidenceValue(record, context);
    // A connected provider is linked from more than one route shape
    // (/dashboard/providers/<id> and /dashboard/media-providers/<capability>/<id>),
    // and each of those labels carries the live connection status. Match the
    // provider by the final path segment so a new route shape cannot reintroduce
    // an unmasked "<provider> Connected" label.
    const destSegment = typeof record?.dest === "string" && record.dest.startsWith("/dashboard/")
      ? record.dest.split("/").pop()
      : "";
    const provider = (context.connectedProviders || []).find(({ id }) => id === destSegment);
    if (!provider) return redacted;
    return {
      ...redacted,
      name: provider.replacement,
      key: `${redacted.role}|${provider.replacement}|${redacted.dest}`,
    };
  });
}

function isRedacted(value) {
  const text = value.trim();
  return (
    !text ||
    /^\*+$/.test(text) ||
    /^\[redacted\]$/i.test(text) ||
    /^<[^>]+>$/.test(text) ||
    /^\$\{[A-Z0-9_]+\}$/.test(text)
  );
}

export function scanEvidenceText(text, context = {}) {
  const findings = [];
  for (const match of text.matchAll(SECRET_FIELDS)) {
    if (!isRedacted(match[5])) {
      findings.push({ kind: match[2].toLowerCase(), offset: match.index ?? 0 });
    }
  }
  for (const match of text.matchAll(SECRET_HEADERS)) {
    if (!isRedacted(match[4])) findings.push({ kind: match[3].toLowerCase(), offset: match.index ?? 0 });
  }
  for (const match of text.matchAll(SECRET_QUERY)) {
    if (!isRedacted(match[3])) findings.push({ kind: match[2].toLowerCase(), offset: match.index ?? 0 });
  }
  for (const match of text.matchAll(JWT)) {
    findings.push({ kind: "jwt", offset: match.index ?? 0 });
  }
  for (const match of text.matchAll(CLIENT_KEY_FRAGMENT)) {
    findings.push({ kind: "client_api_key", offset: match.index ?? 0 });
  }
  for (const match of text.matchAll(BEARER)) {
    if (!isRedacted(match[0].slice("Bearer ".length))) {
      findings.push({ kind: "bearer", offset: match.index ?? 0 });
    }
  }
  for (const match of text.matchAll(LOCAL_ENDPOINT)) {
    findings.push({ kind: "local_endpoint", offset: match.index ?? 0 });
  }
  for (const match of text.matchAll(EMAIL)) {
    findings.push({ kind: "email", offset: match.index ?? 0 });
  }
  for (const match of text.matchAll(UUID)) {
    findings.push({ kind: "connection_uuid", offset: match.index ?? 0 });
  }
  for (const pattern of [COUNTED_LIVE_STATUS, LIVE_STATUS_PHRASE]) {
    for (const match of text.matchAll(pattern)) {
      findings.push({ kind: "live_status", offset: match.index ?? 0 });
    }
  }
  const matcher = contextAliasMatcher(context);
  if (matcher) {
    for (const match of text.matchAll(matcher.pattern)) {
      findings.push({ kind: "private_evidence", offset: (match.index ?? 0) + match[1].length });
    }
  }
  return findings;
}

// This function is deliberately self-contained because Playwright serializes
// it into the page. Measurements run first. This mutates only the disposable
// capture DOM immediately before a screenshot is written.
export async function maskEvidenceDom(context = {}) {
  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
  // These have to match the module-level patterns above, or a string masked in
  // the JSON still renders into the screenshot. The trailing `\b` on the old key
  // pattern published the visible tail of a partially-masked key, and the old
  // endpoint pattern knew only localhost and 127.x.
  const keyPrefix = "sk|xai|pt|gsk|pk|ghp|gho|ghs|ghu|github_pat|AKIA|ASIA|glpat|xoxb|xoxp|xapp|hf|nvapi|dop_v1|shpat";
  const clientKey = new RegExp(
    `\\b(?:${keyPrefix})[-_][A-Za-z0-9][A-Za-z0-9_-]{15,}`
    + `|\\b(?:${keyPrefix})[-_][A-Za-z0-9][A-Za-z0-9_-]{2,}[*.\\u2022]+[A-Za-z0-9_-]+`,
    "gi");
  const localHost = "localhost|127(?:\\.\\d{1,3}){3}|10(?:\\.\\d{1,3}){3}|192\\.168(?:\\.\\d{1,3}){2}"
    + "|172\\.(?:1[6-9]|2\\d|3[01])(?:\\.\\d{1,3}){2}|0\\.0\\.0\\.0|\\[[0-9a-f:]+\\]"
    + "|[A-Za-z0-9-]+\\.(?:local|lan|internal|home)";
  const localEndpoint = new RegExp(
    `\\b(?:https?://)?(?:${localHost})(?::\\d{1,5})(?:/[^\\s<>"']*)?`
    + `|\\bhttps?://(?:${localHost})(?:/[^\\s<>"']*)?`,
    "gi");
  // Every rendered number on these routes is live deployment data: request
  // counts, spend, cache hit rate, quota remaining, connection counts, relative
  // times. Enumerating the phrases that carry them was always going to miss one,
  // so digits are masked wherever they render and the label beside them is left
  // alone. A screenshot then still shows layout, type and alignment, which is
  // what a visual review needs, without publishing a single live value.
  // A placeholder written by the rules above is skipped whole: masking the hex
  // tail of `[redacted-connected-provider-57de4cf40144]` would destroy the alias
  // without hiding anything, since the alias is already not the live value.
  const digitRun = /\[[a-z-]+-redacted\]|\[redacted-[a-z0-9-]+\]|\d/g;
  const maskDigits = (value) =>
    String(value || "").replace(digitRun, (match) => (match.length === 1 ? "#" : match));
  // A count of connections is a live status even with the count masked, and the
  // pill vocabulary states connectivity in words rather than numbers.
  const liveCountPhrase = /\b[\d#]+\s*(?:connections?|accounts?|keys?|providers?|models?|requests?)\b/gi;
  const statusPill = /\b(?:no connections?|not configured|not connected|no credentials|subscription active|subscription expired|currently active|last used|last call|never used)\b/gi;
  const countedLiveStatus = /\b\d+\s+(?:connected|error|token expired|rate limited|cooling down|last call failed|not tested|disabled)(?:\s*·\s*(?:auth|429|5xx|net|runtime|err|\d{3}))?\b/gi;
  const liveStatusPhrase = /\b(?:token expired|rate limited|cooling down|last call failed|last run failed|refresh failed)\b/gi;
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const aliasReplacements = new Map(
    (context.aliases || []).map(({ value, replacement }) => [value.toLowerCase(), replacement]),
  );
  const aliasAlternatives = (context.aliases || []).map(({ value }) => escape(value)).join("|");
  const aliasPattern = aliasAlternatives
    ? new RegExp(`(^|[^A-Z0-9_-])(${aliasAlternatives})(?=$|[^A-Z0-9_-])`, "gi")
    : null;
  const liveErrorSources = (context.aliases || [])
    .filter(({ replacement }) => replacement.startsWith("[redacted-live-error-"))
    .map(({ value }) => value.toLowerCase());
  const containsLiveState = (value) => {
    const source = String(value || "");
    countedLiveStatus.lastIndex = 0;
    liveStatusPhrase.lastIndex = 0;
    const matchesStatus = countedLiveStatus.test(source) || liveStatusPhrase.test(source);
    countedLiveStatus.lastIndex = 0;
    liveStatusPhrase.lastIndex = 0;
    liveCountPhrase.lastIndex = 0;
    statusPill.lastIndex = 0;
    const matchesPill = liveCountPhrase.test(source) || statusPill.test(source);
    liveCountPhrase.lastIndex = 0;
    statusPill.lastIndex = 0;
    return matchesStatus || matchesPill
      || liveErrorSources.some((item) => source.toLowerCase().includes(item));
  };
  const neutralizeStatus = (element) => {
    if (!element) return;
    element.style.color = "inherit";
    element.style.background = "transparent";
    element.style.borderColor = "currentColor";
  };
  const aliasFor = async (kind, value) => {
    const normalized = String(value).trim().toLowerCase();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 12);
    return `[redacted-${kind}-${hex}]`;
  };
  const redact = async (value) => {
    let output = String(value || "");
    if (aliasPattern) {
      output = output.replace(
        aliasPattern,
        (_, prefix, match) => `${prefix}${aliasReplacements.get(match.toLowerCase())}`,
      );
    }
    output = output
      .replace(countedLiveStatus, "[redacted-live-status]")
      .replace(liveStatusPhrase, "[redacted-live-status]")
      .replace(clientKey, "[redacted-client-api-key]")
      .replace(localEndpoint, "[redacted-local-endpoint]");
    // Digits go before the phrase rules so a masked count still matches them.
    output = maskDigits(output)
      .replace(liveCountPhrase, "[redacted-live-status]")
      .replace(statusPill, "[redacted-live-status]");
    const emails = [...output.matchAll(email)].map(([match]) => match);
    const emailAliases = new Map();
    for (const match of emails) emailAliases.set(match.toLowerCase(), await aliasFor("email", match));
    output = output.replace(email, (match) => emailAliases.get(match.toLowerCase()));
    const uuids = [...output.matchAll(uuid)].map(([match]) => match);
    const uuidAliases = new Map();
    for (const match of uuids) uuidAliases.set(match.toLowerCase(), await aliasFor("connection-id", match));
    return output.replace(uuid, (match) => uuidAliases.get(match.toLowerCase()));
  };

  for (const topology of document.querySelectorAll(".react-flow")) {
    topology.replaceChildren(document.createTextNode("[operational-topology-redacted]"));
  }

  const providerLinks = [...document.querySelectorAll("a[href]")];
  for (const provider of context.connectedProviders || []) {
    const path = `/dashboard/providers/${provider.id}`;
    for (const link of providerLinks) {
      let pathname = "";
      try { pathname = new URL(link.getAttribute("href"), "http://evidence.invalid").pathname; }
      catch { continue; }
      if (pathname !== path) continue;
      link.replaceChildren(document.createTextNode(provider.replacement));
      link.setAttribute("aria-label", provider.replacement);
    }
  }

  const liveStatus = new Set(document.querySelectorAll(
    "[role='alert'],[role='status'],[aria-live]:not([aria-live='off'])," +
    "[class*='border-success/'],[class*='border-warning/'],[class*='border-danger/']",
  ));
  for (const element of liveStatus) {
    // An empty live region has nothing to hide, and replacing its children
    // with a placeholder INVENTS content. The toast container is the case
    // that mattered: normally empty and invisible, `position: fixed` at the
    // viewport corner, so the injected text painted over the header in every
    // screenshot and was then read back as a layout defect that did not exist.
    if (!element.textContent.trim()) continue;
    element.replaceChildren(document.createTextNode("[live-status-redacted]"));
    neutralizeStatus(element);
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const liveState = containsLiveState(node.data);
    node.data = await redact(node.data);
    if (liveState) neutralizeStatus(node.parentElement);
  }
  for (const element of document.querySelectorAll(
    "[aria-label],[aria-labelledby],[title],[placeholder],[data-value],input,textarea",
  )) {
    for (const attribute of ["aria-label", "aria-labelledby", "title", "placeholder", "data-value", "value"]) {
      if (element.hasAttribute(attribute)) {
        element.setAttribute(attribute, await redact(element.getAttribute(attribute)));
      }
    }
    if ("value" in element) element.value = await redact(element.value);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const redact = args[0] === "--redact";
  let rest = args.slice(1);
  // Without the private context the alias rules never fire, so the CLI would
  // report "ok" on a file still naming a connection or a provider node. The
  // context file holds the same {connections, nodes} shape the capture scripts
  // read from the running instance.
  let context = {};
  if (rest[0] === "--context") {
    if (!rest[1]) {
      console.error("--context needs a JSON file of {connections, nodes}");
      process.exit(2);
    }
    context = buildEvidencePrivacyContext(JSON.parse(readFileSync(rest[1], "utf8")));
    rest = rest.slice(2);
  }
  if ((!redact && args[0] !== "--check") || !rest.length) {
    console.error("usage: redactEvidence.mjs --check|--redact [--context FILE] <evidence-file> [...evidence-file]");
    process.exit(2);
  }

  const findings = [];
  for (const file of rest) {
    const raw = readFileSync(file, "utf8");
    const text = redact ? redactEvidenceText(raw, context) : raw;
    if (redact && text !== raw) writeFileSync(file, text);
    for (const finding of scanEvidenceText(text, context)) {
      findings.push({ file, ...finding });
    }
  }

  if (findings.length) {
    console.error(`evidence redaction failed: ${findings.length} unmasked credential field(s)`);
    for (const finding of findings) {
      console.error(`  ${finding.file}:${finding.offset} (${finding.kind})`);
    }
    process.exit(1);
  }

  console.log("evidence redaction ok");
}
