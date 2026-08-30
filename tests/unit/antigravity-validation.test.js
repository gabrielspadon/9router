import { describe, expect, it } from "vitest";
import {
  classifyAntigravityValidation,
  redactAntigravityValidationText,
  validateAntigravityVerificationUrl,
} from "../../open-sse/services/antigravityValidation.js";

const DOMAINS = [
  "cloudcode-pa.googleapis.com",
  "staging-cloudcode-pa.googleapis.com",
  "autopush-cloudcode-pa.googleapis.com",
];
const URL = "https://accounts.google.com/AccountChooser?token=opaque-secret#step";
const errorInfo = (overrides = {}) => ({
  "@type": "type.googleapis.com/google.rpc.ErrorInfo",
  domain: DOMAINS[0],
  reason: "VALIDATION_REQUIRED",
  metadata: {},
  ...overrides,
});
const help = (links = [{ url: URL }]) => ({
  "@type": "type.googleapis.com/google.rpc.Help",
  links,
});
const rpc = (details, code = 403) => ({ error: { code, message: "validation needed", details } });
const load = (overrides = {}) => ({
  ineligibleTiers: [{ reasonCode: "VALIDATION_REQUIRED", validationUrl: URL }],
  ...overrides,
});

function classify(status, payload, source) {
  return classifyAntigravityValidation({ status, payload, source });
}

function expectRedacted(value, marker = "validation needed") {
  expect(value).not.toContain(URL);
  expect(value).not.toContain("opaque-secret");
  expect(value).toContain(marker);
}

describe("structured contracts", () => {
  it("accepts a successful loadCodeAssist validation tier", () => {
    expect(classify(200, load(), "loadCodeAssist")).toEqual({
      kind: "antigravity_validation_required",
      url: URL,
      source: "loadCodeAssist",
    });
  });

  it.each(DOMAINS)("accepts the exact 403 RPC contract for %s", (domain) => {
    expect(classify(403, rpc([errorInfo({ domain }), help()]), "usage")).toEqual({
      kind: "antigravity_validation_required",
      url: URL,
      source: "usage",
    });
  });

  it("uses validation_link metadata when Help is absent", () => {
    expect(classify(403, rpc([errorInfo({ metadata: { validation_link: URL } })]), "onboardUser")).toEqual({
      kind: "antigravity_validation_required",
      url: URL,
      source: "onboardUser",
    });
  });

  it("uses the first Help link before metadata", () => {
    const preferred = "https://accounts.google.com/challenge?token=preferred";
    expect(classify(403, rpc([errorInfo({ metadata: { validation_link: URL } }), help([{ url: preferred }])]), "chat")).toEqual({
      kind: "antigravity_validation_required",
      url: preferred,
      source: "chat",
    });
  });

  it.each([
    ["rejects a successful tier from another source", 200, load(), "usage"],
    ["rejects a non-successful load response", 403, load(), "loadCodeAssist"],
    ["rejects a load response with currentTier", 200, load({ currentTier: { name: "Pro" } }), "loadCodeAssist"],
    ["rejects a load tier with another reason", 200, load({ ineligibleTiers: [{ reasonCode: "OTHER", validationUrl: URL }] }), "loadCodeAssist"],
    ["rejects a load tier without its action link", 200, load({ ineligibleTiers: [{ reasonCode: "VALIDATION_REQUIRED" }] }), "loadCodeAssist"],
    ["rejects a root action link", 200, load({ ineligibleTiers: [{ reasonCode: "VALIDATION_REQUIRED", validationUrl: "https://accounts.google.com/" }] }), "loadCodeAssist"],
    ["rejects an appeal link", 200, load({ ineligibleTiers: [{ reasonCode: "VALIDATION_REQUIRED", appeal_url: URL }] }), "loadCodeAssist"],
    ["rejects a raw message link", 200, { message: URL }, "loadCodeAssist"],
    ["rejects a non-403 RPC response", 200, rpc([errorInfo(), help()]), "usage"],
    ["rejects a mismatched RPC body code", 403, rpc([errorInfo(), help()], 400), "usage"],
    ["rejects an ErrorInfo detail with a different type", 403, rpc([{ ...errorInfo(), "@type": "type.googleapis.com/google.rpc.Other" }, help()]), "usage"],
    ["rejects an ErrorInfo detail with another domain", 403, rpc([errorInfo({ domain: "accounts.google.com" }), help()]), "usage"],
    ["rejects an RPC detail with another reason", 403, rpc([errorInfo({ reason: "OTHER" }), help()]), "usage"],
    ["rejects an RPC reason with whitespace", 403, rpc([errorInfo({ reason: "VALIDATION_REQUIRED " }), help()]), "usage"],
    ["rejects a later Help link", 403, rpc([errorInfo(), help([{ description: "no url" }, { url: URL }])]), "usage"],
    ["rejects invalid first Help link even with valid metadata", 403, rpc([errorInfo({ metadata: { validation_link: URL } }), help([{ url: "http://accounts.google.com/challenge" }])]), "usage"],
    ["rejects a loosely named metadata field", 403, rpc([errorInfo({ metadata: { validationUrl: URL } })]), "usage"],
    ["rejects a Help detail without ErrorInfo", 403, rpc([help()]), "usage"],
  ])("%s", (_name, status, payload, source) => {
    expect(classify(status, payload, source)).toBeNull();
  });
});

describe("URL validation", () => {
  it.each([
    ["accepts exact HTTPS", URL, URL],
    ["canonicalizes explicit default HTTPS port", "https://accounts.google.com:443/challenge?token=opaque-secret", "https://accounts.google.com/challenge?token=opaque-secret"],
    ["retains opaque path query and fragment", "https://accounts.google.com/v3/signin/challenge/pwd?continue=opaque#step", "https://accounts.google.com/v3/signin/challenge/pwd?continue=opaque#step"],
  ])("%s", (_name, candidate, expected) => {
    expect(validateAntigravityVerificationUrl(candidate)).toBe(expected);
  });

  it.each([
    ["non-string", null],
    ["empty", ""],
    ["leading space", ` ${URL}`],
    ["trailing space", `${URL} `],
    ["C0", `${URL}\u0000`],
    ["DEL", `${URL}\u007f`],
    ["malformed", "https://accounts.google.com:bad/challenge"],
    ["HTTP", "http://accounts.google.com/challenge"],
    ["alternate host", "https://example.com/challenge"],
    ["subdomain", "https://evil.accounts.google.com/challenge"],
    ["trailing dot", "https://accounts.google.com./challenge"],
    ["username", "https://user@accounts.google.com/challenge"],
    ["password", "https://user:pass@accounts.google.com/challenge"],
    ["non-default port", "https://accounts.google.com:444/challenge"],
    ["overlong UTF-8 input", `https://accounts.google.com/${"a".repeat(8193)}`],
    ["overlong canonical href", `https://accounts.google.com/${"é".repeat(2000)}`],
  ])("rejects %s", (_name, candidate) => {
    expect(validateAntigravityVerificationUrl(candidate)).toBeNull();
  });
});

describe("redaction", () => {
  it("redacts the camel-case validation field", () => {
    expectRedacted(redactAntigravityValidationText(JSON.stringify({ message: "validation needed", validationUrl: URL })));
  });

  it("redacts the snake-case validation field", () => {
    expectRedacted(redactAntigravityValidationText(JSON.stringify({ message: "validation needed", validation_url: URL })));
  });

  it("redacts validation_link", () => {
    expectRedacted(redactAntigravityValidationText(JSON.stringify({ message: "validation needed", validation_link: URL })));
  });

  it("redacts Help links when error details carry validation", () => {
    expectRedacted(redactAntigravityValidationText(JSON.stringify(rpc([errorInfo(), help()]))));
  });

  it("redacts malformed raw accounts links", () => {
    expectRedacted(redactAntigravityValidationText(`validation needed at ${URL} then continue`));
  });
});
