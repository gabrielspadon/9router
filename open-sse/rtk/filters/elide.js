// Size-based catch-all, NOT content-sniffed: for oversized blobs that match no
// structured filter, keep head+tail verbatim, elide the middle, and record an
// integrity marker (char count + HMAC of the elided span) so nothing is
// silently lost. Wired in index.js only after autoDetectFilter returns null.
// Contract: returns null on no-match (len <= ELIDE_MIN_CHARS, degenerate
// overlap, or would-grow), same convention as the autodetect chain's no-match.
import { createHmac, randomBytes } from "crypto";
import {
  ELIDE_MIN_CHARS,
  ELIDE_HEAD_CHARS,
  ELIDE_TAIL_CHARS,
  ELIDE_NEWLINE_WINDOW,
} from "../constants.js";

// SEC-1: a bare sha256 of the middle was a brute-force oracle for low-entropy
// elided content (probe recovered a 5-char middle in 2.6s, and the marker
// ships in provider-visible prompts). HMAC-SHA256 under a per-process random
// key that never leaves the host kills the offline probe. Integrity
// verification is local-only: the marker is NOT stable across restarts —
// harmless, since elided text differs from prior bytes anyway once elided, so
// cache-epoch (ce=) implications are nil.
const ELIDE_INTEGRITY_KEY = randomBytes(32);

export function elide(input) {
  if (typeof input !== "string" || input.length <= ELIDE_MIN_CHARS) return null;

  const len = input.length;

  // Head boundary: nearest newline within the window around the cut so the
  // head never ends mid-line. The boundary newline itself is elided; the
  // marker's leading "\n" supplies the line break. Only ever shrinks the head.
  let headEnd = ELIDE_HEAD_CHARS;
  const headNl = input.indexOf("\n", Math.max(0, ELIDE_HEAD_CHARS - ELIDE_NEWLINE_WINDOW));
  if (headNl !== -1 && headNl <= ELIDE_HEAD_CHARS + ELIDE_NEWLINE_WINDOW - 1) {
    headEnd = headNl;
  }

  // Tail boundary: same preference at the tail's start. The tail only ever
  // starts later, never grows.
  let tailStart = len - ELIDE_TAIL_CHARS;
  const tailNl = input.indexOf("\n", tailStart);
  if (tailNl !== -1 && tailNl <= tailStart + ELIDE_NEWLINE_WINDOW - 1) {
    tailStart = tailNl + 1;
  }

  if (headEnd >= tailStart) return null; // degenerate overlap, never split

  const middle = input.slice(headEnd, tailStart);
  // SEC-1: HMAC under the per-process key, not a bare hash — see comment above.
  const hmac = createHmac("sha256", ELIDE_INTEGRITY_KEY).update(middle, "utf8").digest("hex").slice(0, 8);
  const marker = `\n[elided ${middle.length} chars · hmac ${hmac} · head+tail preserved by tokenproxy]\n`;

  // Never grow the input (defensive: unreachable at ELIDE_MIN_CHARS=4000
  // with a ~60-char marker, kept as the floor if the constants ever shrink)
  if (headEnd + (len - tailStart) + marker.length >= len) return null;

  return input.slice(0, headEnd) + marker + input.slice(tailStart);
}

elide.filterName = "elide";
