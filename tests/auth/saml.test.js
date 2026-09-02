// Runner note: these assertions use node:assert, which throws on failure and so
// works unchanged inside vitest. Only the harness import moves. Taken from the
// built-in test module they were collected but never counted: vitest reported
// "No test suite found" and the file sat in the known-fail baseline asserting
// nothing, while the project and CI run vitest only.
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  formatX509Certificate,
  isSamlConfigured,
  generateSamlMetadata,
  pickSamlEmail,
  pickSamlDisplayName,
} from "../../src/lib/auth/saml.js";

test("formatX509Certificate normalizes Base64 strings into PEM blocks", () => {
  const rawBase64 = "MIIC1234567890123456789012345678901234567890123456789012345678901234567890";
  const formatted = formatX509Certificate(rawBase64);
  assert.match(formatted, /-----BEGIN CERTIFICATE-----/);
  assert.match(formatted, /-----END CERTIFICATE-----/);
  assert.equal(formatX509Certificate(""), "");
});

test("isSamlConfigured checks required fields", () => {
  assert.equal(isSamlConfigured({ samlEntryPoint: "https://idp.com/sso", samlCert: "cert" }), true);
  assert.equal(isSamlConfigured({ samlEntryPoint: "https://idp.com/sso" }), false);
  assert.equal(isSamlConfigured({}), false);
});

test("generateSamlMetadata produces valid SP XML", () => {
  const settings = {
    samlEntryPoint: "https://idp.example.com/sso",
    samlIssuer: "urn:tokenproxy:sp",
    samlCert: "MIIC123456789012345678901234567890123456789012345678901234567890",
  };
  const xml = generateSamlMetadata("https://localhost:20127", settings);
  assert.match(xml, /entityID="urn:tokenproxy:sp"/);
  assert.match(xml, /Location="https:\/\/localhost:20127\/api\/auth\/saml\/acs"/);
});

test("Claims Extraction pickSamlEmail & pickSamlDisplayName", () => {
  const profile = { email: "test@example.com", name: "Test User" };
  assert.equal(pickSamlEmail(profile, {}), "test@example.com");
  assert.equal(pickSamlDisplayName(profile, {}), "Test User");
});
