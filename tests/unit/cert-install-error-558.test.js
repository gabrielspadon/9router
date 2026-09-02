import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const install = readFileSync(new URL("../../src/mitm/cert/install.js", import.meta.url), "utf8");
const dns = readFileSync(new URL("../../src/mitm/dns/dnsConfig.js", import.meta.url), "utf8");
const mac = install.slice(install.indexOf("async function installCertMac"), install.indexOf("async function installCertWindows"));

// Every macOS cert-install failure was replaced with a fixed "Certificate
// install failed", so a wrong password, a locked keychain and an SIP refusal all
// reported the same thing and the user had nothing to act on.
describe("the macOS cert install reports what actually failed (#558)", () => {
  it("carries the underlying error text through", () => {
    expect(mac).toContain("Certificate install failed: ${detail}");
    expect(mac).toContain("error.message");
  });

  it("still names a user cancellation specifically", () => {
    expect(mac).toContain('includes("canceled")');
    expect(mac).toContain("User canceled authorization");
  });

  it("falls back to the plain message when there is no detail", () => {
    expect(mac).toContain('detail ? `Certificate install failed: ${detail}` : "Certificate install failed"');
  });

  it("bounds the detail rather than pasting an unbounded blob", () => {
    expect(mac).toMatch(/slice\(0,\s*\d+\)/);
  });

  it("the surfaced text is stderr, which never carries the sudo password", () => {
    // sudo -S reads the password from stdin and does not echo it, so passing
    // stderr to the user is safe. Pinned because that is the reason a blanket
    // message was defensible in the first place.
    expect(dns).toContain("reject(new Error(stderr ||");
    expect(dns).toContain("child.stdin.write(`${password}");
  });
});
