#!/usr/bin/env node
// Smoke test against the test instance (default http://localhost:20129, override with SMOKE_BASE).
// Covers the dashboard page, the statistics API shape and gateway auth. It never calls a real
// upstream, so it costs nothing.
// Usage: node scripts/smoke-test.mjs
const BASE = process.env.SMOKE_BASE || "http://localhost:20129";
let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failed++;
};

// 1. dashboard page is reachable
const page = await fetch(`${BASE}/dashboard`).then((r) => r.status).catch(() => 0);
ok("dashboard page reachable", page === 200, `status=${page}`);

// 2. Log in for a session. The test instance has its own DB, default password 123456, and
//    loopback logins are allowed.
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: process.env.SMOKE_PASSWORD || "123456" }),
}).catch(() => null);
const cookie = loginRes?.headers.getSetCookie?.()?.[0]?.split(";")[0] || "";
ok("dashboard login works", !!cookie, loginRes ? `status=${loginRes.status}` : "no response");

// 3. Statistics API returns the full shape, using the session cookie
const stats = await fetch(`${BASE}/api/usage/statistics?pageSize=5`, {
  headers: cookie ? { Cookie: cookie } : {},
})
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);
ok("statistics api responds", !!stats, stats ? "" : "no/invalid response");
if (stats && !stats.error) {
  for (const k of ["filters", "summary", "series", "items", "pagination"]) {
    ok(`statistics.${k} present`, k in stats);
  }
}

// 4. Gateway liveness. /v1/models without a key should return 401 when auth is enforced, or
//    200 when auth is disabled or the call is local. A 5xx or a timeout means it is down.
const models = await fetch(`${BASE}/v1/models`).then((r) => r.status).catch(() => 0);
ok("gateway /v1/models alive", models === 401 || models === 200, `status=${models}`);

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
