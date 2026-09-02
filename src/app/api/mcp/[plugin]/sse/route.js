import { registerSession, unregisterSession, findPlugin } from "@/lib/mcp/stdioSseBridge";
import { isLocalRequest, hasValidCliToken } from "@/dashboardGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Defense in depth for #1114. These routes drive MCP stdio plugins, so reaching
// them means talking to a local child process, and a mistake here is remote code
// execution rather than a data leak. dashboardGuard already restricts /api/mcp/
// through LOCAL_ONLY_PATHS, but that is one list in one file: a middleware
// config change, or a new route added beside these, silently removes the only
// check. The predicate mirrors the middleware exactly rather than inventing a
// narrower one, so a CLI token stays as valid here as it is there.
async function assertLocalOnly(request) {
  if (isLocalRequest(request)) return null;
  if (await hasValidCliToken(request)) return null;
  return { error: "Local only: MCP requires localhost access" };
}


export async function GET(request, { params }) {
  const denied = await assertLocalOnly(request);
  if (denied) return new Response(JSON.stringify(denied), { status: 403, headers: { "Content-Type": "application/json" } });

  const { plugin } = await params;
  if (!findPlugin(plugin)) {
    return new Response(`Unknown plugin: ${plugin}`, { status: 404 });
  }

  const encoder = new TextEncoder();
  let sid;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk) => controller.enqueue(encoder.encode(chunk));
      sid = registerSession(plugin, send);
      // MCP SSE handshake: tell client where to POST messages.
      send(`event: endpoint\ndata: /api/mcp/${plugin}/message?sessionId=${sid}\n\n`);
    },
    cancel() {
      if (sid) unregisterSession(plugin, sid);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
