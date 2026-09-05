// The AUTHZ collector, shared by the two gates that call adminDecision
// (src/dashboardGuard.js and src/lib/admin/guard.js) so their log lines cannot
// drift apart. The decision itself stays pure in policy.js; this module only
// prints it through the shared emitter (docs/logging-design.md rows 6-8).

import { decide, requestRid } from "@/shared/observability/decide.js";
import { hasTrustedPeerHeaders } from "@/lib/auth/trustedPeer";

/**
 * Peer classification for AUTHZ lines. An IP only when custom-server stamped
 * x-tp-real-ip from the TCP socket and proved it with the peer token; anything
 * else is "unstamped" (attacker-supplied input is not a classification), and a
 * missing request is "unknown".
 */
export function adminPeerOf(request) {
  if (!request || typeof request !== "object" || !request.headers) return "unknown";
  if (hasTrustedPeerHeaders(request)) {
    return request.headers.get("x-tp-real-ip") || "unknown";
  }
  return "unstamped";
}

function adminPathname(request, fallback) {
  if (typeof fallback === "string" && fallback) return fallback;
  try {
    return new URL(request.url).pathname;
  } catch {
    return "unknown";
  }
}

/**
 * Print one AUTHZ line for an adminDecision result. Admin traffic is
 * low-volume and every admit is an audit fact, so admits always speak; the
 * emitter's fold helper still applies its 1,2,4,8 repeat folding, which at
 * admin volume is indistinguishable from always.
 *
 * @param {Request|null} request - in scope at the collector, else rid mints.
 * @param {object} facts - the same four booleans handed to adminDecision.
 * @param {string} facts.authClass
 * @param {boolean} facts.mutating
 * @param {boolean} facts.operator
 * @param {boolean} facts.inference
 * @param {boolean} facts.loopback
 * @param {string} [facts.pathname] - avoids re-parsing request.url.
 * @param {object|null} decision - adminDecision's return. `null` (legacy
 *   allow shape) is treated as an operator admit.
 */
export function logAdminAuthz(request, facts, decision) {
  if (!decision) {
    decision = {
      allow: true,
      by: facts.operator ? "operator" : facts.inference ? "inference" : "loopback",
    };
  }
  const path = adminPathname(request, facts.pathname);
  const base = { rid: requestRid(request), path };

  if (decision.allow) {
    decide("AUTHZ", "admit", {
      ...base,
      class: facts.authClass,
      by: decision.by,
      operator: facts.operator,
      inference: facts.inference,
      loopback: facts.loopback,
      peer: adminPeerOf(request),
    });
    return;
  }

  if (decision.mutation) {
    decide("AUTHZ", "mutation-refused", { ...base, peer: adminPeerOf(request) });
    return;
  }

  decide("AUTHZ", "refused", {
    ...base,
    presented: decision.presented,
    required: decision.required,
  });
}
