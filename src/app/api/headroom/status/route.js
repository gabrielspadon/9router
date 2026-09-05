import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { DEFAULT_HEADROOM_URL, getHeadroomStatus } from "@/lib/headroom/detect";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getSettings();
    const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
    const status = await getHeadroomStatus(url);
    // `running` says the proxy answers, which is not the same as the router
    // sending anything to it. A reachable proxy with the toggle off reported
    // Running and compressed nothing, silently (#1956), so the toggle travels
    // with the probe and `active` is the state a reader actually wants.
    const enabled = settings.headroomEnabled === true;
    return NextResponse.json({
      ...status,
      enabled,
      active: enabled && status.running === true,
      url,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
