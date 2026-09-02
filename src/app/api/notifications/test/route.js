import { NextResponse } from "next/server";
import { deliver, getNotificationsConfig } from "@/lib/notifications/webhooks.js";
import { canWriteNotifications } from "../authz.js";
import { assertPublicUrl, SSRF_BLOCKED_ERROR_CODE } from "@/shared/utils/ssrfGuard.js";

export const dynamic = "force-dynamic";

// POST /api/notifications/test
//   { endpointId }            -> test a saved endpoint, secret included
//   { url, secret? }          -> test a URL before saving it
//
// retries: 0 — an operator waiting on a button must not sit through 36s of
// backoff to learn the URL is wrong. Real events keep the full retry ladder.
export async function POST(request) {
  if (!(await canWriteNotifications(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let endpoint;
  if (body?.endpointId) {
    const config = await getNotificationsConfig();
    endpoint = config.endpoints.find((e) => e.id === body.endpointId);
    if (!endpoint) return NextResponse.json({ error: "Unknown endpoint" }, { status: 404 });
  } else if (typeof body?.url === "string" && body.url.trim()) {
    endpoint = { id: "test", url: body.url.trim(), secret: typeof body.secret === "string" ? body.secret : "" };
  } else {
    return NextResponse.json({ error: "url or endpointId is required" }, { status: 400 });
  }

  try {
    assertPublicUrl(endpoint.url);
  } catch (error) {
    if (error?.code === SSRF_BLOCKED_ERROR_CODE) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid webhook URL" }, { status: 400 });
  }

  const result = await deliver(
    endpoint,
    "test",
    { message: "TokenProxy webhook test", at: new Date().toISOString() },
    { retries: 0 },
  );
  return NextResponse.json(result);
}
