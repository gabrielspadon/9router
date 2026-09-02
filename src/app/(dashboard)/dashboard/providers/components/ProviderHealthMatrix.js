"use client";

import PropTypes from "prop-types";
import Link from "next/link";
import { Table, THead, TBody, TR, TH, TD } from "@/shared/components/Table";
import StatusToken from "@/shared/components/StatusToken";

// Signature element 4, direction.md:85: "Health, headroom, latency and error
// rate for every connected upstream in one grid."
//
// The route already knew how many connections a provider had and nothing about
// how they were performing, so the degraded upstream was only identifiable by
// leaving the page whose name is Providers. Both halves of the answer already
// existed on the server and neither needed a new endpoint:
//
//   error rate + latency  GET /api/usage/stats/health?groupBy=provider, which
//                         reads the requestStats rows every request writes.
//   quota headroom        `lastQuotaSnapshot` on the connections this route
//                         already fetches; it is a non-secret field and the
//                         client payload has always carried it.
//
// A grid, not cards: this is a comparison across upstreams, and cards are
// reserved for portable objects. One row per upstream, numerals tabular, every
// state paired with a glyph and a word.

// Headroom is the tightest window, not an average: an account with 80 percent
// of its month left and 2 percent of its five-hour window left is about to
// stop, and the mean would hide that.
function headroomFor(connections) {
  let lowest = null;
  for (const c of connections) {
    for (const w of c?.lastQuotaSnapshot?.windows || []) {
      if (w.unlimited) continue;
      const remaining = Number(w.remainingPercentage);
      if (!Number.isFinite(remaining)) continue;
      if (lowest === null || remaining < lowest) lowest = remaining;
    }
  }
  return lowest;
}

// A rate needs a denominator to mean anything. Under 20 requests the error
// rate is noise, so the count is shown and the rate is withheld rather than
// rendered as a confident 33 percent from three requests.
const RATE_FLOOR = 20;

function errorTone(rate) {
  if (rate === null) return "idle";
  if (rate >= 0.1) return "failing";
  if (rate > 0) return "degraded";
  return "ok";
}

function headroomTone(pct) {
  if (pct === null) return "idle";
  if (pct <= 10) return "failing";
  if (pct <= 25) return "degraded";
  return "ok";
}

export default function ProviderHealthMatrix({ rows, period }) {
  if (!rows || rows.length === 0) return null;

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold leading-tight sm:text-xl">
          Upstream health
        </h2>
        {/* The window travels with the numbers: a success rate with no period
            attached is not a measurement.
            The word and the period are separate text nodes on purpose. The
            runtime translator looks a whole text node up in a map keyed by the
            English source, so a label with the period interpolated into it is
            a string no locale file can ever contain; split, "Last" is
            translatable and the period code stays a code. */}
        <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-muted">
          Last <span className="normal-case">{period}</span>
        </p>
      </div>
      <Table label="Health, headroom, latency and error rate per connected upstream">
        <THead>
          <TR>
            <TH>Upstream</TH>
            <TH>State</TH>
            <TH numeric>Requests</TH>
            <TH numeric>Errors</TH>
            <TH numeric>Latency</TH>
            <TH numeric>Headroom</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => {
            const rate = r.requests >= RATE_FLOOR ? r.errors / r.requests : null;
            const tone = errorTone(rate);
            const hTone = headroomTone(r.headroom);
            return (
              <TR key={r.provider} tone={tone === "failing" ? "danger" : tone === "degraded" ? "warning" : "default"}>
                {/* The name is the way to the fix: a failing upstream is a
                    click from its own page. It is also what keeps this row out
                    of published evidence, because the screenshot masker
                    replaces the text of a link to /dashboard/providers/<id>
                    with a stable alias, and a provider identity paired with a
                    live state is exactly what must not be captured. */}
                <TD className="max-w-[14rem]">
                  <Link
                    href={`/dashboard/providers/${r.provider}`}
                    // An observation-density row is 32px, so a link that fills
                    // its cell still lands under the 44px phone floor. `hit-44`
                    // paints the pointer target as an overlay centred on the
                    // link, which is a real enlarged target rather than a
                    // waiver, and keeps the row height the density asks for.
                    // The truncation sits on an inner span, not on the link:
                    // `truncate` carries `overflow: hidden`, which would clip
                    // the overlay back to the link's own box and leave a target
                    // that measures 44 and behaves like 19.
                    className="focus-ring hit-44 block hover:text-brand"
                    title={r.name}
                  >
                    <span className="block truncate">{r.name}</span>
                  </Link>
                </TD>
                <TD>
                  <StatusToken tone={tone}>
                    {rate === null ? "Too few" : rate >= 0.1 ? "Failing" : rate > 0 ? "Degraded" : "Healthy"}
                  </StatusToken>
                </TD>
                <TD numeric>{r.requests.toLocaleString()}</TD>
                <TD numeric>
                  {rate === null ? r.errors.toLocaleString() : `${(rate * 100).toFixed(1)}%`}
                </TD>
                {/* Averaged over the samples that measured a latency at all;
                    the repo excludes rows that recorded none rather than
                    counting them as instant. */}
                <TD numeric>
                  {r.avgLatencyMs === null || r.avgLatencyMs === undefined
                    ? "—"
                    : `${Math.round(r.avgLatencyMs)} ms`}
                </TD>
                <TD numeric>
                  {r.headroom === null ? (
                    "—"
                  ) : (
                    <StatusToken tone={hTone} className="ms-auto">{`${r.headroom}%`}</StatusToken>
                  )}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </section>
  );
}

ProviderHealthMatrix.propTypes = {
  rows: PropTypes.arrayOf(
    PropTypes.shape({
      provider: PropTypes.string.isRequired,
      name: PropTypes.string.isRequired,
      requests: PropTypes.number.isRequired,
      errors: PropTypes.number.isRequired,
      avgLatencyMs: PropTypes.number,
      headroom: PropTypes.number,
    }),
  ),
  period: PropTypes.string,
};

export { headroomFor, RATE_FLOOR };
