const { err, createResponseDumper } = require("../logger");
const { IS_DEV } = require("../config");
const { fetchRouter, pipeSSE } = require("./base");

// TokenProxy's OWN gate, never Google's: fetchRouter strips the client Authorization
// header (STRIP_HEADERS in ./base.js) and sends ROUTER_API_KEY instead, so a 401
// or 403 from /v1/chat/completions is about this proxy's key, not the IDE's
// session. src/sse/handlers/chat.js answers 401 "Missing API key" whenever
// requireApiKey is on and the two disagree.
const ROUTER_AUTH_FAILURES = new Set([401, 403]);

/**
 * Intercept Antigravity request — forward Gemini body as-is to /v1/chat/completions.
 * Router auto-detects format via body.userAgent==="antigravity" + body.request.contents,
 * runs antigravity→openai→provider→openai→antigravity translators internally.
 *
 * Never fails the request. Enabling this tool pins cloudcode-pa.googleapis.com and
 * daily-cloudcode-pa.googleapis.com to 127.0.0.1 for the whole machine (TOOL_HOSTS
 * in src/shared/constants/mitmToolHosts.js), so anything answered here that the IDE
 * reads as a failure takes its chat down for as long as the proxy runs — and a 401
 * relayed from the router made it report the user's Google sign-in as broken and
 * offer a re-login that could never fix it (#1295). The dispatcher hands this
 * handler `passthrough` (src/mitm/server.js:341): forward to the real upstream,
 * which resolves the target IP itself and so bypasses the hosts pin.
 */
async function intercept(req, res, bodyBuffer, mappedModel, passthrough) {
  const dumper = IS_DEV ? createResponseDumper(req, "intercept-antigravity") : null;
  const isStream = req.url.includes(":streamGenerateContent");
  try {
    const body = JSON.parse(bodyBuffer.toString());
    if (body.model) body.model = mappedModel;

    const routerRes = await fetchRouter(body, "/v1/chat/completions", req.headers);
    if (ROUTER_AUTH_FAILURES.has(routerRes.status) && typeof passthrough === "function") {
      err(`[antigravity] router refused this proxy's key (${routerRes.status}) — forwarding upstream`);
      if (dumper) dumper.end();
      return passthrough(req, res, bodyBuffer);
    }
    await pipeSSE(routerRes, res, dumper);
  } catch (error) {
    err(`[antigravity] ${error.message}`);
    if (dumper) { dumper.writeChunk(`\n[ERROR] ${error.message}\n`); dumper.end(); }
    // Router unreachable or the body was unparseable: same shape as the 401 above,
    // and nothing has been written yet, so the IDE can still be handed its own
    // upstream instead of an error it cannot act on.
    if (!res.headersSent && typeof passthrough === "function") {
      return passthrough(req, res, bodyBuffer);
    }
    // For stream endpoint, send SSE error chunk so SDK doesn't hang waiting
    if (isStream) {
      if (!res.headersSent) res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ error: { message: error.message } })}\r\n\r\n`);
    } else {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: error.message, type: "mitm_error" } }));
    }
  }
}

module.exports = { intercept };
