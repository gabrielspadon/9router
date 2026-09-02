import { describe, expect, it } from "vitest";
import { applyOperatorHeaders, forwardClientHeaders } from "open-sse/utils/clientHeaderPassthrough.js";
import { readFileSync } from "node:fs";

const exec = readFileSync(new URL("../../open-sse/executors/default.js", import.meta.url), "utf8");

// An endpoint behind an API gateway authenticates with its own header rather
// than a bearer token (Azure APIM's Ocp-Apim-Subscription-Key is the common
// case). A generic openai-compatible connection had no way to say so: the auth
// descriptor hardcodes bearer and nothing read a per-connection override, so
// those endpoints were simply unreachable (#2660).
const ours = () => ({ "Content-Type": "application/json", Authorization: "Bearer sk-default" });
const cfg = (customHeaders) => ({ customHeaders });

describe("an operator can configure a connection's headers (#2660)", () => {
  it("adds a gateway's own auth header", () => {
    const h = applyOperatorHeaders(ours(), cfg({ "Ocp-Apim-Subscription-Key": "abc123" }));
    expect(h["Ocp-Apim-Subscription-Key"]).toBe("abc123");
  });

  it("CAN override this router's auth, which is the whole point", () => {
    // The client passthrough must never do this; operator config must.
    const h = applyOperatorHeaders(ours(), cfg({ Authorization: "SharedKey operator" }));
    expect(h.Authorization).toBe("SharedKey operator");
  });

  it("replaces a header regardless of the casing this router used", () => {
    const h = applyOperatorHeaders({ "content-type": "application/json" },
      cfg({ "Content-Type": "application/xml" }));
    expect(h["Content-Type"]).toBe("application/xml");
    expect(h["content-type"]).toBeUndefined();
  });

  it("an empty value REMOVES a header this router would otherwise send", () => {
    // The only way to reach an endpoint that rejects one of our defaults.
    const h = applyOperatorHeaders(ours(), cfg({ authorization: "" }));
    expect(h.Authorization).toBeUndefined();
    expect(h["Content-Type"]).toBe("application/json");
  });

  it("refuses framing headers, whoever sets them", () => {
    // Overriding these does not configure a provider, it corrupts the message.
    const h = applyOperatorHeaders(ours(), cfg({
      host: "elsewhere", "content-length": "9", "transfer-encoding": "chunked", connection: "close",
    }));
    for (const k of ["host", "content-length", "transfer-encoding", "connection"])
      expect(h[k]).toBeUndefined();
  });

  it("ignores a malformed config rather than throwing on the request path", () => {
    const h = ours();
    expect(applyOperatorHeaders(h, null)).toBe(h);
    expect(applyOperatorHeaders(h, {})).toBe(h);
    expect(applyOperatorHeaders(h, cfg("not-an-object"))).toBe(h);
    expect(applyOperatorHeaders(h, cfg(["a", "b"]))).toBe(h);
  });

  it("skips a non-string value and an empty name", () => {
    const h = applyOperatorHeaders(ours(), cfg({ "X-A": 5, "X-B": null, "  ": "x", "X-C": "ok" }));
    expect(h["X-A"]).toBeUndefined();
    expect(h["X-B"]).toBeUndefined();
    expect(h["X-C"]).toBe("ok");
  });
});

describe("precedence between the operator and the caller", () => {
  it("the caller cannot override what the operator configured", () => {
    const h = ours();
    applyOperatorHeaders(h, cfg({ "X-Tenant": "operator" }));
    forwardClientHeaders(h, { "x-tenant": "caller" });
    expect(h["X-Tenant"]).toBe("operator");
    expect(h["x-tenant"]).toBeUndefined();
  });

  it("the caller still gets headers the operator said nothing about", () => {
    const h = ours();
    applyOperatorHeaders(h, cfg({ "X-Tenant": "operator" }));
    forwardClientHeaders(h, { "X-Session-ID": "s1" });
    expect(h["X-Session-ID"]).toBe("s1");
  });

  it("the executor applies them in that order", () => {
    const op = exec.indexOf("applyOperatorHeaders(headers, credentials?.providerSpecificData)");
    const cl = exec.indexOf("forwardClientHeaders(headers, credentials?.rawHeaders)");
    expect(op).toBeGreaterThan(0);
    expect(op).toBeLessThan(cl);
  });

  it("both run after this router has built its own auth", () => {
    const auth = exec.indexOf("applyAuth(headers, desc, credentials)");
    expect(exec.indexOf("applyOperatorHeaders(headers,")).toBeGreaterThan(auth);
  });
});
