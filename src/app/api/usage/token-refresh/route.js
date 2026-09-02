import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { summarizeTokenRotation } from "@/lib/tokenRefreshAnalytics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/usage/token-refresh — token rotation across every connection that
// has any (#3570). Derived from state the refresh path already persists, so it
// costs one DB read and never touches a provider. Poll it for a live card; the
// values move on their own because they are relative to now.
export async function GET() {
  try {
    const connections = await getProviderConnections();
    return NextResponse.json(summarizeTokenRotation(connections), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[API] Failed to get token refresh analytics:", error);
    return NextResponse.json({ error: "Failed to fetch token refresh analytics" }, { status: 500 });
  }
}
