#!/usr/bin/env node
// Loopback relay for the live token-saver audit. Sits between the test
// instance and the production gateway and stamps the per-request opt-out
// header on every forwarded request, so the production savers stay out of the
// measurement while its OAuth credentials do the upstream call. Nothing else
// is touched: method, path, body and every other header pass through.
//
// SHIM_PORT (default 20140) -> SHIM_UPSTREAM (default http://127.0.0.1:20128)

import { createServer, request as httpRequest } from "node:http";

const PORT = Number(process.env.SHIM_PORT || 20140);
const UPSTREAM = new URL(process.env.SHIM_UPSTREAM || "http://127.0.0.1:20128");
if (!["127.0.0.1", "localhost"].includes(UPSTREAM.hostname)) {
  throw new Error("SHIM_UPSTREAM must be loopback");
}

createServer((req, res) => {
  const headers = { ...req.headers, host: UPSTREAM.host, "x-tokenproxy-token-saver": "off" };
  const up = httpRequest(
    { hostname: UPSTREAM.hostname, port: UPSTREAM.port, method: req.method, path: req.url, headers },
    (upRes) => {
      res.writeHead(upRes.statusCode, upRes.headers);
      upRes.pipe(res);
    },
  );
  up.on("error", (err) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { type: "shim_upstream_error", message: err.message } }));
  });
  req.pipe(up);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`shim listening on 127.0.0.1:${PORT} -> ${UPSTREAM.origin} (token savers off upstream)`);
});
