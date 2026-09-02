import { NextResponse } from "next/server";
// Imported from the repo rather than @/lib/db/index.js: the barrel's export
// list is owned elsewhere, and this is the only consumer of the function.
import { getProviderHealth } from "@/lib/db/repos/usageRepo.js";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);
// provider → one row per provider; account → per account of it; model → per
// model on that account. The three grains #1336 asks for, nothing wider.
const VALID_GROUP_BY = new Set(["provider", "account", "model"]);

export const dynamic = "force-dynamic";

// GET /api/usage/stats/health?period=7d&groupBy=account[&startDate&endDate]
// Measured response time and success rate per provider, per account, or per
// model, read from the requestStats rows every request already writes.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";
    const groupBy = searchParams.get("groupBy") || "account";
    const startDate = searchParams.get("startDate");
    const range = startDate
      ? { startDate, endDate: searchParams.get("endDate") || null }
      : null;

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }
    if (!VALID_GROUP_BY.has(groupBy)) {
      return NextResponse.json({ error: "Invalid groupBy" }, { status: 400 });
    }

    return NextResponse.json(await getProviderHealth({ period, range, groupBy }));
  } catch (error) {
    console.error("[API] Failed to get provider health:", error);
    return NextResponse.json({ error: "Failed to fetch provider health" }, { status: 500 });
  }
}
