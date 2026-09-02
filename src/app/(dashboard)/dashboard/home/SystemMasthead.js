"use client";

import Link from "next/link";
import Readout from "@/shared/components/Readout";
import StatusToken from "@/shared/components/StatusToken";
import EndpointHandoff from "./EndpointHandoff";
import { useSystemState } from "./useSystemState";
import { translate } from "@/i18n/runtime";
import { formatMeasure, freshnessTone, describeWindow } from "./formatMeasure";

// The band that answers "is the router healthy?" before an operator has to ask
// anything else. It is a band, not a card: rules and insets carry the structure,
// so it reads as instrumentation across the top of the page rather than as one
// more rounded rectangle in a stack of them.
//
// Six measures, chosen because each one changes what an operator does next.
// Nothing here is computed in the browser. Every figure and every absence comes
// from /api/system/state, which states its own units, window and reasons.

// The readouts are a grid of divs rather than a description list. A `dl` looked
// right for label-and-value pairs and axe was correct to reject it: a `dl` whose
// children carry no `dt`/`dd` is malformed markup, and `Readout` renders label
// and value as one unit rather than as a pair this markup could split. The
// region is named by its heading instead.
// Labels go through `translate` for the same reason every other visible string
// in this project does: the locale files are keyed by the English source text,
// so a string that never reaches `translate` can never be translated at all, and
// it stays English in a right-to-left interface where everything around it has
// turned. The reason text from the backend is left alone; it is written for a
// maintainer and there is no key for it.
//
// failoverCount is absent from this list rather than rendered blank. It is
// permanently unanswerable — src/app/api/system/state/route.js states why in
// UNANSWERABLE, and says a caller should hide the tile rather than reserve
// space for a value no data can ever supply. A tile that is empty on every
// load teaches an operator to read past the whole band. Wire it back in here
// the day a failover event is persisted.
// `phone: false` drops a measure at phone width. The design system asks the
// masthead to collapse there to the two readouts that change a decision,
// throughput and error rate; the degraded count is already in the status line
// above this grid. p95, spend and the connected count are worth a column at
// laptop width and are a reason to scroll on a 390px screen.
const MEASURES = [
  { key: "throughput", label: "Throughput", phone: true },
  { key: "latencyP95", label: "p95 latency", phone: false },
  { key: "errorRate", label: "Error rate", alarmAbove: 0.02, phone: true },
  { key: "spend", label: "Spend", phone: false },
  { key: "connectedUpstreams", label: "Connected", phone: false },
];

function toneFor(spec, measure, formatted) {
  if (!formatted.available) return "default";
  if (spec.alarmAbove !== undefined && Number(measure?.value) > spec.alarmAbove) {
    return "danger";
  }
  return "default";
}

const CAUSE_LABELS = {
  authentication: "authentication",
  rate_limited: "rate limited",
  unavailable: "provider unavailable",
  connection_test: "connection check failed",
  upstream_error: "upstream error",
};

function providerLabel(provider) {
  return String(provider || "unknown").replace(/[-_]+/g, " ");
}

function likelyCause(provider) {
  const cause = provider?.likelyCauses?.[0];
  return translate(CAUSE_LABELS[cause] || CAUSE_LABELS.upstream_error);
}

export default function SystemMasthead({ windowSeconds = 3600 }) {
  const { data, error, phase, refresh } = useSystemState({ windowSeconds });

  const measures = data?.measures || {};
  const refreshFailed = phase === "failed" && Boolean(data);
  const fresh = freshnessTone(
    phase === "refreshing" && data
      ? { ...data.freshness, state: "refreshing" }
      : refreshFailed
        ? { ...data.freshness, state: "stale" }
        : data?.freshness,
  );
  const windowLabel = describeWindow(data?.window);
  const degraded = formatMeasure(measures.degradedUpstreams);
  const degradedProvider = data?.providerHealth?.degradedProviders?.[0] || null;
  const additionalProviders = Number(data?.providerHealth?.degradedProviderCount || 0) - 1;

  return (
    <section
      aria-labelledby="system-state-heading"
      className="border-b border-border bg-surface"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5.5 pt-4">
        <h2
          id="system-state-heading"
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted"
        >
          {translate("Router state")}
          {windowLabel ? (
            <span className="normal-case tracking-normal"> {windowLabel}</span>
          ) : null}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {degradedProvider ? (
            <>
              <StatusToken tone="degraded">
                {providerLabel(degradedProvider.provider)} {translate("degraded")}: {likelyCause(degradedProvider)}
              </StatusToken>
              <Link
                href={`/dashboard/providers/${encodeURIComponent(degradedProvider.provider)}`}
                className="focus-ring inline-flex min-h-11 items-center gap-1 px-1.5 font-mono text-[10.5px] text-brand hover:text-brand-hover"
                aria-label={`${translate("Review Provider")} ${providerLabel(degradedProvider.provider)}`}
              >
                <span aria-hidden="true" className="material-symbols-outlined dir-icon text-sm">arrow_forward</span>
                {translate("Review Provider")}
              </Link>
              {additionalProviders > 0 ? (
                <span className="font-mono text-[10.5px] text-text-muted">
                  +{additionalProviders} {translate("more")}
                </span>
              ) : null}
            </>
          ) : degraded.available && Number(measures.degradedUpstreams?.value) > 0 ? (
            <StatusToken tone="degraded">
              {degraded.value}{" "}
              {translate(degraded.value === "1" ? "upstream degraded" : "upstreams degraded")}
            </StatusToken>
          ) : null}
          <StatusToken tone={fresh.tone}>{fresh.label}</StatusToken>
          {refreshFailed ? (
            <>
              <StatusToken tone="degraded">{translate("refresh failed; retrying")}</StatusToken>
              <button
                type="button"
                onClick={refresh}
                title={error || undefined}
                className="focus-ring min-h-11 px-1.5 font-mono text-[10.5px] text-brand hover:text-brand-hover"
              >
                {translate("Retry now")}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {error && !data ? (
        <p role="alert" className="px-5.5 py-4 text-sm text-danger">
          {translate("Router state is unavailable")}: {error}.{" "}
          {translate("The router itself is unaffected; only this summary failed to load.")}
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-2 border-t border-border sm:grid-cols-3 lg:grid-cols-5">
          {MEASURES.map((spec) => {
            const measure = measures[spec.key];
            const f = formatMeasure(measure);
            return (
              <div
                key={spec.key}
                className={`border-border px-3 py-2 sm:px-5.5 sm:py-3 [&:not(:last-child)]:border-e ${
                  spec.phone ? "" : "hidden sm:block"
                }`}
              >
                <Readout
                  label={translate(spec.label)}
                  value={
                    phase === "loading" && !data ? (
                      <span className="text-text-muted">—</span>
                    ) : f.available ? (
                      f.value
                    ) : (
                      <span className="text-text-muted">—</span>
                    )
                  }
                  unit={f.available ? f.unit : ""}
                  tone={toneFor(spec, measure, f)}
                />
                {f.available && f.sampleCount ? (
                  <p className="mt-1 font-mono text-[10.5px] text-text-muted">
                    {translate("over")} {f.sampleCount}{" "}
                    {translate(f.sampleCount === 1 ? "request" : "requests")}
                  </p>
                ) : null}
                {!f.available ? (
                  <p
                    className="mt-1 hidden line-clamp-2 text-xs leading-snug text-text-muted sm:block"
                    title={f.reason || undefined}
                  >
                    {f.value}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Signature element 5, in the band that is already on every route. The
          endpoint page owns keys and the tunnel; this owns the one answer to
          "where do I point my client", which is otherwise a navigation away
          from whatever the operator was actually doing. */}
      <EndpointHandoff />
    </section>
  );
}
