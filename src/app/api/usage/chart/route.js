import { NextResponse } from "next/server";
import { getChartData } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

// #3442: a date range answers "yesterday" and "the day before", which the fixed
// trailing periods cannot. Both are optional and inclusive local days; without
// startDate the request behaves exactly as it did.
function rangeFrom(searchParams) {
  const startDate = searchParams.get("startDate");
  if (!startDate) return null;
  return { startDate, endDate: searchParams.get("endDate") || null };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";
    const range = rangeFrom(searchParams);

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const data = await getChartData(period, range);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get chart data:", error);
    return NextResponse.json({ error: "Failed to fetch chart data" }, { status: 500 });
  }
}
