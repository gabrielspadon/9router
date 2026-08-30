import {
  authorizeAntigravityVerification,
  withAntigravityVerificationHeaders,
} from "@/lib/auth/antigravityVerificationAccess";
import {
  getAntigravityVerificationSnapshot,
  subscribeAntigravityVerification,
} from "@/lib/antigravityVerification";

const HEARTBEAT_MS = 25_000;
const encoder = new TextEncoder();

function encodeEvent(type, payload) {
  return encoder.encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export async function GET(request) {
  const authorization = await authorizeAntigravityVerification(request);
  if (!authorization.ok) return authorization.response;

  let unsubscribe = null;
  let heartbeat = null;
  let controllerRef = null;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    request.signal.removeEventListener("abort", cleanup);
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    unsubscribe?.();
    unsubscribe = null;
    try {
      controllerRef?.close();
    } catch {
      // The client may already have cancelled the stream.
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller;
      controller.enqueue(encodeEvent("snapshot", { entries: getAntigravityVerificationSnapshot() }));
      unsubscribe = subscribeAntigravityVerification((event) => {
        if (cleaned || (event.type !== "upsert" && event.type !== "remove")) return;
        const payload = event.type === "upsert"
          ? { connectionId: event.connectionId, challengeId: event.challengeId, expiresAt: event.expiresAt }
          : { connectionId: event.connectionId, challengeId: event.challengeId };
        controller.enqueue(encodeEvent(event.type, payload));
      });
      heartbeat = setInterval(() => {
        if (!cleaned) controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, HEARTBEAT_MS);
      if (request.signal.aborted) cleanup();
      else request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel: cleanup,
  });

  return new Response(stream, {
    headers: withAntigravityVerificationHeaders({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0, no-transform",
      "X-Accel-Buffering": "no",
    }),
  });
}
