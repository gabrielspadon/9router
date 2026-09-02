/**
 * Cursor MITM handler — interception is not implemented, and this handler does
 * not pretend otherwise.
 *
 * Only the CLIENT half of Cursor's Connect-RPC protobuf exists in this tree:
 * `open-sse/executors/cursor.js` decodes `agent.v1.AgentServerMessage` frames and
 * answers the server's context request. Serving a Cursor IDE needs the SERVER
 * half — decoding the IDE's outbound Run body and encoding those frames back,
 * including the exec/tool handshake that same executor calls unservable. A
 * partial decode would hand the IDE wrong content, which is worse than not
 * intercepting.
 *
 * What it must NOT do is fail the request. Enabling this tool pins
 * api2.cursor.sh to 127.0.0.1 for the whole machine (TOOL_HOSTS in
 * src/shared/constants/mitmToolHosts.js), so answering 501 took Cursor's chat
 * down for as long as the proxy ran. The dispatcher hands this handler
 * `passthrough` (src/mitm/server.js:324) for exactly this case: forward to the
 * real upstream — it resolves the target IP itself, bypassing the hosts pin —
 * and leave the IDE working natively.
 */
async function intercept(req, res, bodyBuffer, mappedModel, passthrough) {
  if (typeof passthrough === "function") return passthrough(req, res, bodyBuffer);

  // No forwarder supplied: say so rather than hanging the stream.
  res.writeHead(501, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    error: {
      message: "Cursor MITM interception is not implemented.",
      type: "not_implemented"
    }
  }));
}

module.exports = { intercept };
