"use strict";

// Rewrite Antigravity IDE markers so upstream AG 2.x backend accepts the request.
// User-Agent header (antigravity/<old>) and body.metadata.ideVersion are forced
// to a known-good IDE version. Hardcoded MVP — toggle/version configurable later.

// Single source of truth: open-sse/providers/shared.js pins the official
// Antigravity IDE version (Antigravity IDE Desktop fingerprint). require(ESM)
// works on Node >= 22.18 / 25, which is the Docker + host runtime floor.
const { ANTIGRAVITY_IDE_VERSION } = require("../../open-sse/providers/shared.js");
const ANTIGRAVITY_IDE_VERSION_OVERRIDE_ENABLED = true;

function shouldRewriteMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  if (String(metadata.ideName || "").toLowerCase() === "antigravity") return true;
  if (String(metadata.ideType || "").toUpperCase() === "ANTIGRAVITY") return true;
  return Object.prototype.hasOwnProperty.call(metadata, "ideVersion");
}

function rewriteAntigravityUserAgent(userAgent, version) {
  if (typeof userAgent !== "string" || !userAgent.includes("antigravity/")) return userAgent;
  return userAgent.replace(/antigravity\/[^\s]+/, `antigravity/${version}`);
}

// Chat turns only (:generateContent / :streamGenerateContent). loadCodeAssist,
// onboardUser and other account-setup/session calls must reach Google carrying
// the IDE's real User-Agent and metadata -- see #1884: rewriting those too made
// Google's account-setup flow see a different IDE fingerprint than the one that
// established the OAuth session, and it started asking the user to sign in again.
function isAntigravityChatEndpoint(url) {
  return typeof url === "string" && (url.includes(":generateContent") || url.includes(":streamGenerateContent"));
}

function applyAntigravityIdeVersionOverride(bodyBuffer, headers) {
  if (!ANTIGRAVITY_IDE_VERSION_OVERRIDE_ENABLED) {
    return { bodyBuffer, headers, applied: false, version: ANTIGRAVITY_IDE_VERSION };
  }

  const nextHeaders = { ...headers };
  const nextUserAgent = rewriteAntigravityUserAgent(nextHeaders["user-agent"], ANTIGRAVITY_IDE_VERSION);
  const userAgentChanged = nextUserAgent !== nextHeaders["user-agent"];
  if (userAgentChanged) nextHeaders["user-agent"] = nextUserAgent;

  try {
    const parsed = JSON.parse(bodyBuffer.toString());
    if (!shouldRewriteMetadata(parsed?.metadata)) {
      return { bodyBuffer, headers: nextHeaders, applied: userAgentChanged, version: ANTIGRAVITY_IDE_VERSION };
    }

    parsed.metadata.ideVersion = ANTIGRAVITY_IDE_VERSION;
    const nextBodyBuffer = Buffer.from(JSON.stringify(parsed));
    return { bodyBuffer: nextBodyBuffer, headers: nextHeaders, applied: true, version: ANTIGRAVITY_IDE_VERSION };
  } catch {
    return { bodyBuffer, headers: nextHeaders, applied: userAgentChanged, version: ANTIGRAVITY_IDE_VERSION };
  }
}

module.exports = {
  ANTIGRAVITY_IDE_VERSION,
  applyAntigravityIdeVersionOverride,
  rewriteAntigravityUserAgent,
  isAntigravityChatEndpoint,
};
