import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeProxyUrl } from "../../src/shared/utils/proxyUrl.js";

const cp = readFileSync(new URL("../../src/lib/network/connectionProxy.js", import.meta.url), "utf8");

// The proxy-pool importer accepted host:port:user:pass while the per-connection
// proxy field ran the raw string through new URL() and rejected anything without
// a scheme. Same product, same paste, two answers.
describe("a proxy can be pasted in the vendor shorthand (#962)", () => {
  it("accepts the shorthand forms", () => {
    expect(normalizeProxyUrl("1.2.3.4:8080")).toBe("http://1.2.3.4:8080/");
    expect(normalizeProxyUrl("1.2.3.4:8080:user:pass")).toBe("http://user:pass@1.2.3.4:8080/");
  });

  it("still accepts every full URL form it accepted before", () => {
    for (const p of ["http", "https", "socks", "socks4", "socks4a", "socks5", "socks5h"]) {
      expect(normalizeProxyUrl(`${p}://h:1080`), `${p} was rejected`).toBeTruthy();
    }
  });

  it("returns an already-valid URL byte-for-byte", () => {
    // The value is stored on the connection and propagated into transport
    // options, so normalising it here would silently change data. new URL()
    // .toString() appends a trailing slash, which is exactly that.
    for (const v of ["http://127.0.0.1:9999", "socks5://h:1080", "http://u:p@h:3128"]) {
      expect(normalizeProxyUrl(v), `${v} was rewritten`).toBe(v);
    }
  });

  it("encodes credentials, so a password with @ or : cannot re-parse as a host", () => {
    const out = normalizeProxyUrl("1.2.3.4:8080:user:p@ss");
    expect(out).toContain("p%40ss");
    expect(new URL(out).hostname).toBe("1.2.3.4");
  });

  it("rejects what is not a proxy", () => {
    for (const v of ["ftp://h:21", "not a proxy", "1.2.3.4:notaport", "", "   ", null, undefined, 7]) {
      expect(normalizeProxyUrl(v), `${JSON.stringify(v)} was accepted`).toBeNull();
    }
  });

  it("rejects a partial credential pair rather than guessing", () => {
    expect(normalizeProxyUrl("1.2.3.4:8080:user:")).toBeNull();
    expect(normalizeProxyUrl("1.2.3.4:8080::pass")).toBeNull();
  });

  it("normalises the value that flows downstream, not just the one it checks", () => {
    // Widening the validator alone would hand "host:port:user:pass" straight to
    // the proxy agent. Both resolution paths must carry the normalised URL.
    expect(cp).toContain("const legacyProxyUrl = normalizeProxyUrl(legacy.connectionProxyUrl);");
    expect(cp).toContain("connectionProxyUrl: legacyProxyUrl,");
    expect(cp).toContain("const proxyUrl = normalizeProxyUrl(normalizeString(proxyPool?.proxyUrl));");
    // And the old validate-only helper is gone rather than left dead beside it.
    expect(cp).not.toContain("isSupportedConnectionProxyUrl");
  });
});
