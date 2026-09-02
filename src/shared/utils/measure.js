// The interface may only state what the backend actually measured.
//
// Three outcomes are routinely collapsed into one rendering, and a dash for all
// three is not honesty, it is a different lie. They are kept apart everywhere:
//
//   measured        a number the backend supplied. A real 0 is one of them.
//   not computable  the quantity is defined but has nothing to divide or
//                   average over: a rate with a zero denominator, a share of an
//                   unknown total, an average over an empty population.
//   not recorded    the backend never supplied it, or the request for it failed.
//
// The two absent cases get one short word each, identical on statistics, quota,
// usage and token saver, so an operator learns the vocabulary once.
export const NOT_COMPUTABLE = "n/a";
export const NOT_RECORDED = "not recorded";

// Why the value is absent is the caller's knowledge, not something a formatter
// can infer, so the callers pass null for their own single reason and pick the
// formatter that carries the matching word.
export const isMeasured = (v) => typeof v === "number" && Number.isFinite(v);

// A ratio in 0..1. null ⇒ nothing to divide.
export const fmtRate = (value, digits = 1) =>
  isMeasured(value) ? `${(value * 100).toFixed(digits)}%` : NOT_COMPUTABLE;

// A share already expressed in 0..100. null ⇒ the total is unknown, so the
// share of it that is left cannot be stated.
export const fmtPercent = (value) => (isMeasured(value) ? `${Math.round(value)}%` : NOT_COMPUTABLE);

// A duration in milliseconds. null ⇒ never measured.
// Sub-second values keep their magnitude: 15.75 ms is not "0.0s".
export const fmtDuration = (ms) => {
  if (!isMeasured(ms)) return NOT_RECORDED;
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
};
