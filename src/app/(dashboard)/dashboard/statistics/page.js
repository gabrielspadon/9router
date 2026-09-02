import {
  getStatsFilters,
  getStatsSummary,
  getStatsSeries,
  getStatsItems,
} from "@/lib/db/repos/requestStatsRepo.js";
import StatisticsContent from "./StatisticsContent";
import { readStatsQuery } from "./query.js";

// Server-rendered initial data. A pure client page that fetches after mount
// freezes on this route: every async setState following a client-side
// navigation is silently dropped and the summary cards stay on "…" (root cause
// is below React's visible API — hook state updates land but the async-lane
// render is never scheduled). Rendering the payload server-side sidesteps that
// pipeline entirely.
export const dynamic = "force-dynamic";

async function computeStats(searchParams) {
  // readStatsQuery, not searchParams.get?.(): Next hands this a plain object,
  // which has no get, so the optional call silently dropped every filter and
  // the first paint was rendered over the whole history.
  const filter = readStatsQuery(searchParams);

  const [filters, summary, series, itemsResult] = await Promise.all([
    getStatsFilters(),
    getStatsSummary(filter),
    getStatsSeries(filter),
    getStatsItems({ ...filter, page: 1, pageSize: 50 }),
  ]);

  return {
    filters,
    summary,
    series,
    items: itemsResult.items,
    pagination: itemsResult.pagination,
  };
}

export default async function StatisticsPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const data = await computeStats(sp);
  return <StatisticsContent initialData={data} />;
}
