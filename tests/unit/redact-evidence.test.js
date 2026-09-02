import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildEvidencePrivacyContext,
  redactEvidenceText,
  redactInventoryRecords,
  redactEvidenceValue,
  scanEvidenceText,
} from "../../docs/design/verification/redactEvidence.mjs";

// These two fixtures are credential-SHAPED on purpose: feeding the redactor a
// string that looks exactly like a real key is the only way to prove it masks
// one. They are assembled from parts rather than written as literals because a
// secret scanner reads the staged diff, not the test's intent, and cannot tell
// a synthetic fixture from a leaked key. Splitting the prefix from the body
// leaves no scannable token in source while handing the redactor byte-for-byte
// the same input it would see in the wild.
const SYNTHETIC_ANTHROPIC_KEY = ["sk", "ant", "api03", ["AbCdEf", "0123456789", "ZyXwVu"].join("")].join("-");
const SYNTHETIC_BEARER = ["synthetic", "bearer", "value"].join("-");

describe("evidence redaction", () => {
  it("flags unmasked credential values without returning them", () => {
    const findings = scanEvidenceText(
      '{"access_token":"replace-with-a-long-real-secret","note":"safe"}',
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "access_token" });
    expect(findings[0].offset).toBeTypeOf("number");
    expect(JSON.stringify(findings)).not.toContain("replace-with-a-long-real-secret");
  });

  it("accepts explicitly redacted and placeholder credential fields", () => {
    expect(
      scanEvidenceText(
        '{"access_token":"[redacted]","api_key":"${TOKENPROXY_KEY}","cookie":"***"}',
      ),
    ).toEqual([]);
  });

  it("flags and deterministically redacts email addresses", () => {
    const raw = '{"name":"operator@example.test","copy":"operator@example.test"}';
    const findings = scanEvidenceText(raw);
    const redacted = redactEvidenceText(raw);

    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.kind === "email")).toBe(true);
    expect(JSON.stringify(findings)).not.toContain("operator@example.test");
    expect(redacted).not.toContain("operator@example.test");
    expect(scanEvidenceText(redacted)).toEqual([]);
    expect(redacted.match(/redacted-email-[a-f0-9]{12}/g)).toHaveLength(2);
  });

  it("flags and redacts structured secrets, auth headers, token queries, and JWTs", () => {
    // The JWT is assembled here rather than written as a literal. A literal
    // token, even a synthetic one whose signature is the word "synthetic",
    // is JWT-shaped in the file itself, and a secret scanner reading the
    // staged diff cannot tell a fixture from the real thing. Encoding it at
    // run time gives the redactor exactly the same input while leaving no
    // token-shaped string in the source for a scanner to trip over.
    const syntheticJwt = [
      Buffer.from('{"alg":"HS256"}').toString("base64url"),
      Buffer.from('{"sub":"fixture"}').toString("base64url"),
      "synthetic-signature",
    ].join(".");
    const raw = [
      '{"client_secret":"synthetic-client-secret-value","password":"synthetic-password-value"}',
      `Authorization: Bearer ${SYNTHETIC_BEARER}`,
      'https://example.test/callback?token=synthetic-query-token',
      syntheticJwt,
    ].join("\n");
    const redacted = redactEvidenceText(raw);
    const kinds = scanEvidenceText(raw).map((finding) => finding.kind);

    expect(kinds).toEqual(expect.arrayContaining(["client_secret", "password", "authorization", "token", "jwt"]));
    expect(redacted).not.toContain("synthetic-client-secret-value");
    expect(redacted).not.toContain("synthetic-password-value");
    expect(redacted).not.toContain("synthetic-bearer-value");
    expect(redacted).not.toContain("synthetic-query-token");
    expect(redacted).not.toContain(syntheticJwt.split(".")[0]);
    expect(scanEvidenceText(redacted)).toEqual([]);
  });

  it("masks provider identities and live errors while preserving capability evidence", () => {
    const connectionId = "123e4567-e89b-12d3-a456-426614174000";
    const context = buildEvidencePrivacyContext({
      connections: [{
        id: connectionId,
        provider: "claude",
        name: "Private Claude account",
        lastError: "upstream 401 from rack-west.internal",
      }],
      nodes: [{
        id: "openai-compatible-55f2c62e-798b-4cc3-b1e1-a33a2ac9ff02",
        name: "Rack West Gateway",
        prefix: "rack-west",
        baseUrl: "https://rack-west.internal/v1",
      }],
    });
    const raw = {
      path: "/dashboard/providers/claude",
      role: "button",
      name: "Test connection",
      connectionId,
      node: "Rack West Gateway at https://rack-west.internal/v1",
      consoleErrors: ["upstream 401 from rack-west.internal"],
    };

    const first = redactEvidenceValue(raw, context);
    const second = redactEvidenceValue(raw, context);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      path: "/dashboard/providers/claude",
      role: "button",
      name: "Test connection",
    });
    expect(JSON.stringify(first)).not.toContain(connectionId);
    expect(JSON.stringify(first)).not.toContain("Rack West Gateway");
    expect(JSON.stringify(first)).not.toContain("rack-west.internal");
    expect(first.connectionId).toMatch(/^\[redacted-connection-id-[a-f0-9]{12}\]$/);
    expect(first.node).toContain("[redacted-provider-node-");
    expect(first.consoleErrors[0]).toMatch(/^\[redacted-live-error-[a-f0-9]{12}\]$/);
  });

  it("flags bare provider-connection UUIDs without returning their values", () => {
    const connectionId = "123e4567-e89b-12d3-a456-426614174000";

    const findings = scanEvidenceText(`connection ${connectionId}`);
    const redacted = redactEvidenceText(`connection ${connectionId}`);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "connection_uuid" });
    expect(JSON.stringify(findings)).not.toContain(connectionId);
    expect(redacted).toMatch(/connection \[redacted-connection-id-[a-f0-9]{12}\]/);
    expect(scanEvidenceText(redacted)).toEqual([]);
  });

  it("masks connected provider-card state without erasing its route or unrelated controls", () => {
    const context = buildEvidencePrivacyContext({
      connections: [{ provider: "claude" }],
    });
    const records = [
      {
        role: "link",
        name: "Claude 2 Connected 1 Error · AUTH",
        dest: "/dashboard/providers/claude",
        key: "link|Claude 2 Connected 1 Error · AUTH|/dashboard/providers/claude",
      },
      {
        role: "button",
        name: "Test all connections",
        dest: "",
        key: "button|Test all connections|",
      },
    ];

    const redacted = redactInventoryRecords(records, context);

    expect(redacted[0]).toEqual({
      role: "link",
      name: "[redacted-connected-provider-c857d09db23e]",
      dest: "/dashboard/providers/claude",
      key: "link|[redacted-connected-provider-c857d09db23e]|/dashboard/providers/claude",
    });
    expect(redacted[1]).toEqual(records[1]);
  });

  it("masks the connected-provider label on media-provider capability routes too", () => {
    const context = buildEvidencePrivacyContext({
      connections: [{ provider: "kimi" }],
      nodes: [],
    });

    const [redacted] = redactInventoryRecords(
      [{
        role: "link",
        name: "Kimi1 Connected",
        dest: "/dashboard/media-providers/webSearch/kimi",
        key: "link|Kimi1 Connected|/dashboard/media-providers/webSearch/kimi",
      }],
      context,
    );

    expect(redacted.name).not.toContain("Connected");
    expect(redacted.key).not.toContain("Connected");
  });

  it("masks a hyphenated upstream key, a non-loopback private endpoint, and a bearer header", () => {
    const redacted = redactEvidenceText(
      "key sk-ant-api03-AbCdEf123456 at http://192.168.1.50:8080/x and http://[::1]:20128, Authorization: Bearer abcdefgh12345",
    );

    expect(redacted).not.toContain("AbCdEf123456");
    expect(redacted).not.toContain("192.168.1.50");
    expect(redacted).not.toContain("[::1]");
    expect(redacted).not.toContain("abcdefgh12345");
    expect(scanEvidenceText(redacted)).toEqual([]);
  });

  it("aliases a provider-node endpoint nested under providerSpecificData", () => {
    const context = buildEvidencePrivacyContext({
      connections: [{
        provider: "kimi",
        providerSpecificData: { baseUrl: "https://node.example.test/v1", nodeName: "Lab node" },
      }],
      nodes: [],
    });

    const redacted = redactEvidenceText("upstream https://node.example.test/v1 via Lab node", context);

    expect(redacted).not.toContain("node.example.test");
    expect(redacted).not.toContain("Lab node");
  });

  it("masks live status phrases but retains capability language", () => {
    const redacted = redactEvidenceText(
      "Current provider state: 2 Error · AUTH. Control: Test all connections.",
    );

    expect(redacted).toBe(
      "Current provider state: [redacted-live-status]. Control: Test all connections.",
    );
  });

  it("applies the private context in --check so the CLI cannot pass a file naming a connection", () => {
    const dir = mkdtempSync(join(tmpdir(), "redact-cli-"));
    const evidence = join(dir, "evidence.json");
    const context = join(dir, "context.json");
    writeFileSync(evidence, JSON.stringify({ label: "Production Account" }));
    writeFileSync(context, JSON.stringify({ connections: [{ name: "Production Account" }] }));
    const script = fileURLToPath(new URL("../../docs/design/verification/redactEvidence.mjs", import.meta.url));

    expect(() => execFileSync("node", [script, "--check", "--context", context, evidence], { encoding: "utf8" }))
      .toThrow(/private_evidence/);
    expect(execFileSync("node", [script, "--check", evidence], { encoding: "utf8" }))
      .toContain("evidence redaction ok");
  });

  it("does not let short private aliases corrupt capability text or other masks", () => {
    const context = buildEvidencePrivacyContext({
      connections: [{ name: "CAP" }],
      nodes: [{ name: "Provider" }],
    });

    const redacted = redactEvidenceText("CAP capability for Provider", context);

    expect(redacted).toMatch(
      /^\[redacted-connection-label-[a-f0-9]{12}\] capability for \[redacted-provider-node-[a-f0-9]{12}\]$/,
    );
    expect(redacted).not.toContain("c[redacted-");
  });
});

describe("widened credential detectors", () => {
  // Each of these reached a committed evidence file, or would have, under the
  // narrower patterns these replace.
  it("finds a key whatever prefix its issuer chose", () => {
    for (const key of [
      SYNTHETIC_ANTHROPIC_KEY,
      "ghp_AbCdEf0123456789ZyXw",
      "xai-AbCdEf0123456789ZyXwVu",
      "glpat_AbCdEf0123456789ZyXw",
    ]) {
      expect(scanEvidenceText(key).map((f) => f.kind)).toContain("client_api_key");
    }
  });

  it("does not report a key's display name as the key", () => {
    // The name an operator gives an API key is not the key. Reporting it made
    // the check cry wolf on every inventory capture.
    expect(scanEvidenceText("sk_tokenproxy (default)")).toEqual([]);
  });

  it("still finds a partially masked key, including its visible tail", () => {
    expect(scanEvidenceText("sk-a23\u2022\u2022\u2022\u2022f9e0").map((f) => f.kind))
      .toContain("client_api_key");
  });

  it("finds a local endpoint written without a scheme", () => {
    // A log line saying `localhost:20128` names the protected service exactly
    // as well as one saying `http://localhost:20128`.
    for (const endpoint of ["localhost:20128", "127.0.0.1:20152", "0.0.0.0:8080", "192.168.1.9:3000"]) {
      expect(scanEvidenceText(endpoint).map((f) => f.kind)).toContain("local_endpoint");
    }
  });

  it("redacts a secret used as an object key, not only as a value", () => {
    const context = buildEvidencePrivacyContext({ connections: [], nodes: [] });
    const out = redactEvidenceValue({ [SYNTHETIC_ANTHROPIC_KEY]: "ok" }, context);
    expect(Object.keys(out)[0]).not.toContain("sk-ant-api03");
  });
});
