import { describe, expect, it } from "vitest";
import { redactProxyUrlForLog } from "../../open-sse/utils/proxyFetch.js";
import { logProxySelection } from "../../open-sse/handlers/chatCore.js";

function captureLog() {
  const lines = [];
  const push = (tag, msg) => lines.push(`${tag} ${msg}`);
  return { lines, info: push, debug: push, warn: push, error: push };
}

describe("redactProxyUrlForLog (#2343)", () => {
  it("keeps only scheme, host and port", () => {
    expect(redactProxyUrlForLog("http://user:s3cret@10.0.0.1:8080")).toBe("http://10.0.0.1:8080");
    expect(redactProxyUrlForLog("https://relay.example.com/hook?token=s3cret")).toBe("https://relay.example.com");
  });

  it("fails closed rather than echoing an unparseable value", () => {
    expect(redactProxyUrlForLog("1.2.3.4:8080")).toBe("[invalid proxy URL]");
    expect(redactProxyUrlForLog("")).toBe("[invalid proxy URL]");
    expect(redactProxyUrlForLog(null)).toBe("[invalid proxy URL]");
  });
});

describe("logProxySelection (#2343)", () => {
  const credentials = { connectionName: "acct-1", providerSpecificData: { connectionProxyPoolId: "pool-9" } };

  it("does not print a relay URL's query secret", () => {
    const log = captureLog();
    logProxySelection({
      proxyOptions: { vercelRelayUrl: "https://relay.example.com/api?token=s3cret" },
      credentials,
      provider: "claude",
      model: "sonnet",
      log,
    });
    const joined = log.lines.join("\n");
    expect(joined).not.toContain("s3cret");
    expect(joined).toContain("vercel-relay=https://relay.example.com");
  });

  it("does not print proxy credentials, and does not echo an unparseable proxy URL", () => {
    const log = captureLog();
    logProxySelection({
      proxyOptions: { connectionProxyEnabled: true, connectionProxyUrl: "http://bob:s3cret@10.0.0.1:8080" },
      credentials,
      provider: "claude",
      model: "sonnet",
      log,
    });
    const bad = captureLog();
    logProxySelection({
      proxyOptions: { connectionProxyEnabled: true, connectionProxyUrl: "10.0.0.1:8080?token=s3cret" },
      credentials,
      provider: "claude",
      model: "sonnet",
      log: bad,
    });
    expect(log.lines.join("\n")).not.toContain("s3cret");
    expect(bad.lines.join("\n")).not.toContain("s3cret");
  });
});
