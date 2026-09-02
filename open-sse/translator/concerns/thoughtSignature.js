// Gemini 3 signs every functionCall with a thoughtSignature bound to that call
// and rejects the next turn when history replays the call under a different
// one. The OpenAI pivot format has no field to carry it, so the signature was
// lost on the way out and a constant placeholder stamped on the way back in
// (#3646) — the same class of failure as the Claude signature in #2693.
//
// The tool call id is the only token the client echoes back, but it is also
// client-visible and constrained to [a-zA-Z0-9_-], so a kilobyte-long signature
// cannot ride inside it. Keep the signature here instead, keyed by that id.

const signatures = new Map();

// Bounded FIFO, sized like the other in-memory replay stores (kiroSessionReplay).
// One entry per tool call in flight; oldest is dropped long before memory matters.
const MAX_SIGNATURES = 5000;

// Record the signature upstream returned with a functionCall, under the id the
// response translator handed the client for it.
export function rememberThoughtSignature(toolCallId, signature) {
  if (!toolCallId || typeof signature !== "string" || !signature) return;
  signatures.delete(toolCallId);
  if (signatures.size >= MAX_SIGNATURES) {
    signatures.delete(signatures.keys().next().value);
  }
  signatures.set(toolCallId, signature);
}

// Resolve the signature for a replayed call, falling back to the caller's
// placeholder when nothing signed it here (another provider, a resumed session,
// an evicted entry). Never throws: an unknown id keeps the previous behaviour.
export function thoughtSignatureFor(toolCallId, fallback) {
  if (!toolCallId) return fallback;
  const found = signatures.get(toolCallId);
  if (found === undefined) return fallback;
  // A long conversation replays its whole history every turn, so refresh the
  // entry and let the FIFO evict idle calls rather than live ones.
  signatures.delete(toolCallId);
  signatures.set(toolCallId, found);
  return found;
}
