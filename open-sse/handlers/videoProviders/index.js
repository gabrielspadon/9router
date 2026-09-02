// Video provider adapters, for upstreams the transparent proxy in videoCore
// cannot serve. A provider without an adapter keeps that proxy unchanged.
import gemini from "./gemini.js";

const ADAPTERS = { gemini };

export function getVideoAdapter(provider) {
  return ADAPTERS[provider] || null;
}

/** The adapter that owns a poll id, if any. */
export function findVideoAdapterForRequestId(requestId) {
  for (const adapter of Object.values(ADAPTERS)) {
    if (adapter.ownsRequestId?.(requestId)) return adapter;
  }
  return null;
}
