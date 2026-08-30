export const identityRows = [
  { name: "JWT cookie", jwt: true, expected: true, expectedNoLogin: true },
  { name: "CLI token", cli: true, expected: true, expectedNoLogin: true },
  { name: "trusted IPv4 loopback", trusted: true, realIp: "127.0.0.1", expected: false, expectedNoLogin: true },
  { name: "trusted IPv6 loopback", trusted: true, realIp: "::1", expected: false, expectedNoLogin: true },
  { name: "trusted IPv4-mapped loopback", trusted: true, realIp: "::ffff:127.0.0.1", expected: false, expectedNoLogin: true },
  { name: "proxied loopback", trusted: true, proxied: true, realIp: "127.0.0.1", expected: false, expectedNoLogin: false },
  { name: "unstamped forged loopback", realIp: "127.0.0.1", expected: false, expectedNoLogin: false },
];

export const mutationRows = [
  { name: "same-origin browser", headers: { origin: "http://localhost:20128", "sec-fetch-site": "same-origin" }, allowed: true },
  { name: "CLI token without browser headers", cli: true, headers: {}, allowed: true },
  { name: "missing Origin", headers: { "sec-fetch-site": "same-origin" }, allowed: false },
  { name: "malformed Origin", headers: { origin: "not a URL", "sec-fetch-site": "same-origin" }, allowed: false },
  { name: "cross-origin", headers: { origin: "https://evil.example", "sec-fetch-site": "same-origin" }, allowed: false },
  { name: "trailing slash", headers: { origin: "http://localhost:20128/", "sec-fetch-site": "same-origin" }, allowed: false },
  { name: "origin path", headers: { origin: "http://localhost:20128/path", "sec-fetch-site": "same-origin" }, allowed: false },
  { name: "origin credentials", headers: { origin: "http://user:pass@localhost:20128", "sec-fetch-site": "same-origin" }, allowed: false },
  { name: "opaque null", headers: { origin: "null", "sec-fetch-site": "same-origin" }, allowed: false },
  { name: "alternate textual origin", headers: { origin: "http://LOCALHOST:20128", "sec-fetch-site": "same-origin" }, allowed: false },
  { name: "missing Sec-Fetch-Site", headers: { origin: "http://localhost:20128" }, allowed: false },
  { name: "same-site", headers: { origin: "http://localhost:20128", "sec-fetch-site": "same-site" }, allowed: false },
  { name: "cross-site", headers: { origin: "http://localhost:20128", "sec-fetch-site": "cross-site" }, allowed: false },
  { name: "none", headers: { origin: "http://localhost:20128", "sec-fetch-site": "none" }, allowed: false },
];
