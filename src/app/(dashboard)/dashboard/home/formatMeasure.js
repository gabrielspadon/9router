// Presentation for the system-state envelope.
//
// The contract at src/app/api/system/state/route.js keeps three things apart and
// this module must not collapse them again:
//
//   a measurement, including a real zero
//   a value that could not be computed, such as a rate over no requests
//   a value that was never recorded, or whose source does not exist
//
// A dash for all three reads as one thing to an operator, so each absent case
// gets its own short word plus the backend's own reason, in the readout itself
// rather than in a tooltip. The vocabulary is not defined here: it belongs to
// src/shared/utils/measure.js, which the statistics, quota, usage and token
// saver routes already use, so an operator learns it once across the product.
//
// Telling the two absent cases apart from the envelope alone: a measure that
// names no `source` has no place in the schema it could have come from, so it
// was never recorded. A measure that names a source but has nothing to compute
// from is not computable.

import { translate } from "@/i18n/runtime";
import { NOT_COMPUTABLE, NOT_RECORDED } from "@/shared/utils/measure";

function absent(measure, reason) {
  const neverRecorded = !measure || measure.source === null || measure.source === undefined;
  return {
    available: false,
    value: translate(neverRecorded ? NOT_RECORDED : NOT_COMPUTABLE),
    unit: "",
    reason: reason || null,
    // The backend states its reason for a maintainer, with module paths in it.
    // A readout row has room for the operator half, which is the clause before
    // the colon; the full text stays on the element so a screen reader and a
    // hover both still reach it, and it is never the only carrier of the state.
    shortReason: shortenReason(reason),
    sampleCount: null,
  };
}

// The backend states its reason for a maintainer: a colon then a module path, or
// a parenthetical naming the column that is ambiguous. Both halves are worth
// keeping, but only the first belongs in a readout cell, because the second sets
// the height of the whole band for six numbers that fit on one line.
function shortenReason(reason) {
  if (!reason) return null;
  const first = String(reason).split(/:\s|\s\(/)[0].trim();
  return first.length > 72 ? `${first.slice(0, 71).trimEnd()}\u2026` : first;
}

// Units arrive from the backend in their storage form. The reader wants the form
// that keeps significant digits: a rate of 0.0008 req/s is 0.05 req/min, and
// rounding it to "0.00" would report a busy router as idle.
export function formatMeasure(measure) {
  if (!measure || typeof measure !== "object") return absent(measure, null);
  if (measure.unavailable) return absent(measure, measure.unavailable);
  if (measure.value === null || measure.value === undefined) {
    return absent(measure, measure.unavailable || null);
  }

  const n = Number(measure.value);
  if (!Number.isFinite(n)) return absent(measure, "value is not a finite number");

  // A denominator is only meaningful for a measure computed over a window of
  // requests. An instant count of upstreams is not "over 6 requests"; it is a
  // count of six things, and labelling it with a request denominator is the same
  // class of small lie this band exists to stop telling.
  const overWindow = measure.window?.kind !== "instant";
  const base = {
    available: true,
    reason: null,
    sampleCount: overWindow ? (measure.sampleCount ?? null) : null,
  };

  switch (measure.unit) {
    case "requests_per_second":
      return n < 1
        ? { ...base, value: (n * 60).toFixed(2), unit: "req/min" }
        : { ...base, value: n.toFixed(2), unit: "req/s" };
    case "milliseconds":
      return n < 1000
        ? { ...base, value: String(Math.round(n)), unit: "ms" }
        : { ...base, value: (n / 1000).toFixed(2), unit: "s" };
    case "ratio":
      return { ...base, value: (n * 100).toFixed(2), unit: "%" };
    case "usd":
      return { ...base, value: n.toFixed(n < 1 ? 4 : 2), unit: "USD" };
    case "count":
      return { ...base, value: String(Math.round(n)), unit: "" };
    default:
      return { ...base, value: String(n), unit: measure.unit || "" };
  }
}

// Freshness is a state an operator acts on, not a decoration. Stale says how old,
// because "stale" without an age gives them nothing to decide with.
export function freshnessTone(freshness) {
  if (!freshness || typeof freshness !== "object") {
    return { tone: "idle", label: translate("no data"), state: "unknown" };
  }
  const age = Number(freshness.ageSeconds);
  const ageLabel = Number.isFinite(age) ? humaniseAge(age) : null;

  switch (freshness.state) {
    case "live":
      return { tone: "ok", label: translate("live"), state: "live" };
    case "refreshing":
      return { tone: "info", label: translate("refreshing"), state: "refreshing" };
    case "stale":
      return {
        tone: "degraded",
        label: ageLabel ? `${translate("stale")}, ${ageLabel}` : translate("stale"),
        state: "stale",
      };
    case "idle":
      return {
        tone: "idle",
        label: ageLabel ? `${translate("idle")}, ${ageLabel}` : translate("idle"),
        state: "idle",
      };
    case "empty":
      return { tone: "idle", label: translate("no traffic yet"), state: "empty" };
    default:
      return { tone: "idle", label: translate("no data"), state: "unknown" };
  }
}

function humaniseAge(seconds) {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 36) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// The window is stated once for the whole band rather than repeated on every
// readout, so it has to read as a sentence fragment on its own.
export function describeWindow(window) {
  if (!window || typeof window !== "object") return "";
  if (window.kind === "instant") return translate("now");
  const seconds = Number(window.seconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 3600) return `${translate("last")} ${Math.round(seconds / 60)} ${translate("min")}`;
  if (seconds % 3600 === 0 && seconds < 86400) {
    const hours = seconds / 3600;
    return hours === 1 ? `${translate("last")} 60 ${translate("min")}` : `${translate("last")} ${hours} ${translate("h")}`;
  }
  return `${translate("last")} ${Math.round(seconds / 3600)} ${translate("h")}`;
}
