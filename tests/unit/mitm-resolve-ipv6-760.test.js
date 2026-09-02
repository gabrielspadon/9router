import { describe, expect, it, beforeEach, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// #760: with MITM + DNS on, the hosts file points cloudcode-pa.googleapis.com at
// 127.0.0.1, so EVERY Antigravity call reaches this proxy -- including the
// account/login traffic, which is never intercepted and only passes through.
// The passthrough resolved the real upstream with an IPv4-only resolver
// (`setServers(["8.8.8.8"])` + resolve4 alone). On an IPv6-only network there is
// no route to 8.8.8.8 and no A record to connect to, so resolution threw, every
// passthrough 502'd, and the IDE reported that Google sign-in was broken.
describe("MITM upstream resolution on IPv6-only networks (#760)", () => {
  const modPath = require.resolve("../../src/mitm/resolveTargetIP.js");

  /** Load a fresh copy of the module with node:dns stubbed. */
  function loadWithDns({ v4, v6 }) {
    const servers = [];
    const stub = {
      Resolver: class {
        setServers(list) { servers.push(...list); }
        resolve4(host, cb) { v4(host, cb); }
        resolve6(host, cb) { v6(host, cb); }
      },
    };
    delete require.cache[modPath];
    const dnsPath = require.resolve("dns");
    const savedDns = require.cache[dnsPath];
    require.cache[dnsPath] = { id: dnsPath, filename: dnsPath, loaded: true, exports: stub };
    try {
      return { mod: require(modPath), servers };
    } finally {
      if (savedDns) require.cache[dnsPath] = savedDns;
      else delete require.cache[dnsPath];
      delete require.cache[modPath];
    }
  }

  const ENODATA = () => Object.assign(new Error("queryA ENODATA"), { code: "ENODATA" });
  const ENETUNREACH = () => Object.assign(new Error("connect ENETUNREACH"), { code: "ENETUNREACH" });

  beforeEach(() => vi.restoreAllMocks());

  it("queries an IPv6 nameserver as well as the IPv4 one", async () => {
    const { mod, servers } = loadWithDns({
      v4: (_h, cb) => cb(null, ["142.250.1.1"]),
      v6: (_h, cb) => cb(ENODATA()),
    });
    await mod.resolveTargetIP("cloudcode-pa.googleapis.com");
    // An IPv6-only host cannot reach a bare IPv4 nameserver address at all.
    expect(servers.some((s) => s.includes(":"))).toBe(true);
  });

  it("falls back to the AAAA record when A resolution fails", async () => {
    const { mod } = loadWithDns({
      v4: (_h, cb) => cb(ENETUNREACH()),
      v6: (_h, cb) => cb(null, ["2607:f8b0:4004:c07::5f"]),
    });
    await expect(mod.resolveTargetIP("cloudcode-pa.googleapis.com"))
      .resolves.toBe("2607:f8b0:4004:c07::5f");
  });

  it("falls back to the AAAA record when A returns no addresses", async () => {
    const { mod } = loadWithDns({
      v4: (_h, cb) => cb(null, []),
      v6: (_h, cb) => cb(null, ["2607:f8b0::1"]),
    });
    await expect(mod.resolveTargetIP("daily-cloudcode-pa.googleapis.com"))
      .resolves.toBe("2607:f8b0::1");
  });

  it("still prefers IPv4 when an A record exists, so dual-stack is unchanged", async () => {
    let v6Called = false;
    const { mod } = loadWithDns({
      v4: (_h, cb) => cb(null, ["142.250.1.1"]),
      v6: (_h, cb) => { v6Called = true; cb(null, ["2607:f8b0::1"]); },
    });
    await expect(mod.resolveTargetIP("api2.cursor.sh")).resolves.toBe("142.250.1.1");
    expect(v6Called, "AAAA lookup is only a fallback").toBe(false);
  });

  it("reports a real failure rather than caching undefined when neither family resolves", async () => {
    const { mod } = loadWithDns({
      v4: (_h, cb) => cb(ENODATA()),
      v6: (_h, cb) => cb(ENODATA()),
    });
    await expect(mod.resolveTargetIP("nowhere.invalid")).rejects.toThrow(/No A or AAAA record/);
  });

  it("caches a resolved address instead of re-querying per request", async () => {
    let v4Calls = 0;
    const { mod } = loadWithDns({
      v4: (_h, cb) => { v4Calls++; cb(null, ["142.250.1.1"]); },
      v6: (_h, cb) => cb(ENODATA()),
    });
    await mod.resolveTargetIP("q.us-east-1.amazonaws.com");
    await mod.resolveTargetIP("q.us-east-1.amazonaws.com");
    expect(v4Calls).toBe(1);
  });
});
