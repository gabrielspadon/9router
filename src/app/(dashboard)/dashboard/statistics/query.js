// One reader for the statistics query string.
//
// There were two: the server page called `searchParams.get?.()` on the plain
// object Next hands it, which has no `get`, so every dimension came back
// undefined and the first paint was never filtered; and the client never read
// the URL at all, so its mount refetch asked for everything while the chips
// said "All providers". Both halves now read the URL through here.
//
// The client holds a URLSearchParams (useSearchParams); the server page holds a
// plain object whose repeated keys arrive as arrays. Both are accepted.

const DIMENSIONS = ["provider", "connectionId", "model"];

function raw(params, key) {
  if (!params) return undefined;
  if (typeof params.get === "function") return params.get(key);
  return params[key];
}

// A dimension is absent (undefined) or a non-empty list. An empty list would
// read as "filter on nothing" downstream, which matches no rows.
function list(params, key) {
  const v = raw(params, key);
  const parts = (Array.isArray(v) ? v : String(v ?? "").split(","))
    .map((s) => String(s).trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

function isoDate(params, key) {
  const v = raw(params, key);
  if (!v) return undefined;
  const d = new Date(Array.isArray(v) ? v[0] : v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function readStatsQuery(params) {
  const query = {};
  for (const key of DIMENSIONS) query[key] = list(params, key);
  query.startDate = isoDate(params, "startDate");
  query.endDate = isoDate(params, "endDate");
  return query;
}

// A URL that pins a range is a range the period control has no preset for, so
// it selects Custom rather than claiming the data covers all time.
export const initialPeriodFor = (query) =>
  query?.startDate || query?.endDate ? "custom" : "all";
