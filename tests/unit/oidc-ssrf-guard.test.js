import { describe, it, expect } from "vitest";
import { assertPublicUrl } from "../../src/shared/utils/ssrfGuard.js";

describe("assertPublicUrl (OIDC issuer guard)", () => {
  it("rejects link-local metadata IP", () => {
    expect(() => assertPublicUrl("http://169.254.169.254")).toThrow();
  });

  it("rejects IPv6 loopback", () => {
    expect(() => assertPublicUrl("http://[::1]:8080")).toThrow();
  });

  it("rejects localhost hostname", () => {
    expect(() =>
      assertPublicUrl("http://localhost/.well-known/openid-configuration"),
    ).toThrow();
  });

  it("accepts public https issuer", () => {
    expect(() => assertPublicUrl("https://accounts.google.com")).not.toThrow();
  });
});
