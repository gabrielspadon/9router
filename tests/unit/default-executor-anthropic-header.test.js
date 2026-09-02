import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "open-sse/executors/default.js";

const ANTHROPIC_VERSION = "2024-10-22";

const AUTH_DESCRIPTORS = [
  ["combined", { combined: true, header: "x-api-key", scheme: "raw", anthropicVersion: true }],
  ["split", {
    apiKey: { header: "x-api-key", scheme: "raw" },
    oauth: { header: "Authorization", scheme: "bearer" },
    anthropicVersion: true,
  }],
];

function buildClaudeTransportHeaders(auth, headers = {}) {
  return new DefaultExecutor("opencode-go").buildHeaders({
    apiKey: "test-key",
    runtimeTransport: { headers, auth },
  });
}

describe("DefaultExecutor Anthropic version headers", () => {
  it.each(AUTH_DESCRIPTORS)("preserves an existing Anthropic version for %s auth", (_, auth) => {
    for (const headerName of ["Anthropic-Version", "anthropic-version"]) {
      const headers = buildClaudeTransportHeaders(auth, { [headerName]: ANTHROPIC_VERSION });
      const versionHeaders = Object.entries(headers).filter(([name]) => name.toLowerCase() === "anthropic-version");

      expect(versionHeaders).toEqual([[headerName, ANTHROPIC_VERSION]]);
    }
  });

  it.each(AUTH_DESCRIPTORS)("adds the default Anthropic version for %s auth when absent", (_, auth) => {
    const headers = buildClaudeTransportHeaders(auth);

    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });
});
