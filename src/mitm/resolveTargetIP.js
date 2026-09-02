// Upstream address resolution for the MITM passthrough path.
//
// Public DNS is queried directly, never the system resolver: the hosts entries
// this proxy installs point every intercepted hostname at 127.0.0.1, so the
// system resolver would send each forwarded request straight back here.
//
// Both address families are listed, and AAAA is tried when A yields nothing,
// because an IPv6-only network (#760) has no route to 8.8.8.8 and no A record
// to connect to. Resolution failing there broke EVERY passthrough, the
// account/login calls included -- those are never intercepted, they only pass
// through -- so the IDE reported a broken Google sign-in whenever MITM + DNS
// were on.

const dns = require("dns");
const { promisify } = require("util");

const DNS_SERVERS = ["8.8.8.8", "2001:4860:4860::8888"];
const CACHE_TTL_MS = 5 * 60 * 1000;

const cachedTargetIPs = {};

async function resolveTargetIP(hostname) {
  const cached = cachedTargetIPs[hostname];
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.ip;

  const resolver = new dns.Resolver();
  resolver.setServers(DNS_SERVERS);
  const resolve4 = promisify(resolver.resolve4.bind(resolver));
  const resolve6 = promisify(resolver.resolve6.bind(resolver));

  let addresses = await resolve4(hostname).catch(() => []);
  if (!addresses?.length) addresses = await resolve6(hostname).catch(() => []);
  if (!addresses?.length) throw new Error(`No A or AAAA record for ${hostname}`);

  cachedTargetIPs[hostname] = { ip: addresses[0], ts: Date.now() };
  return cachedTargetIPs[hostname].ip;
}

/** Drop the resolution cache. For tests and for a network change. */
function clearTargetIPCache() {
  for (const key of Object.keys(cachedTargetIPs)) delete cachedTargetIPs[key];
}

module.exports = { resolveTargetIP, clearTargetIPCache, DNS_SERVERS, CACHE_TTL_MS };
