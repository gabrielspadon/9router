import { hasValidCliToken, isLocalRequest } from "@/dashboardGuard";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { resolveClientApiKey } from "@/lib/auth/clientApiKey";
import { validateApiKey } from "@/lib/db/repos/apiKeysRepo.js";
import { adminAuthClass, adminDecision, adminError, isAdminMutation } from "./policy.js";

/**
 * Credential collection for /api/admin, the route half of the two-collector
 * split described in policy.js.
 *
 * WHY A SECOND GATE AT ALL. src/dashboardGuard.js already refuses these paths
 * as middleware, but middleware is a deployment property: a route imported
 * directly by a test, a future standalone handler mount, or a matcher edit all
 * bypass it. The ABI's byteIdenticalOnRejection clause is a promise about
 * state, and a promise that only one layer keeps is a promise waiting for a
 * config change. Both layers reach the same verdict through adminDecision().
 *
 * WHY requireLogin IS NOT CONSULTED. /api/health/detail treats requireLogin
 * === false as operator because it only discloses. These endpoints drain
 * accounts and move releases, so they take the ALWAYS_PROTECTED path instead:
 * a real CLI token or a real signed session, every time.
 */

async function isOperator(request) {
  if (await hasValidCliToken(request)) return true;
  const token = request.cookies?.get?.("auth_token")?.value;
  return Boolean(token && (await verifyDashboardAuthToken(token)));
}

async function hasInferenceKey(request) {
  try {
    return (await resolveClientApiKey(request, validateApiKey)).valid;
  } catch {
    // A database that cannot answer must not upgrade an anonymous caller.
    return false;
  }
}

function pathOf(request) {
  if (request?.nextUrl?.pathname) return request.nextUrl.pathname;
  try {
    return new URL(request.url).pathname;
  } catch {
    return "";
  }
}

/**
 * @returns {Promise<null|Response>} null to proceed, else the refusal to return
 *   verbatim. Callers MUST return it before reading or writing any state.
 */
export async function requireAdmin(request) {
  const authClass = adminAuthClass(pathOf(request));
  const mutating = isAdminMutation(request.method);
  const operator = await isOperator(request);
  const denial = adminDecision({
    authClass,
    mutating,
    operator,
    // Only asked when it can still change the answer: an operator is already
    // past the class check, and validating a key is a database round trip.
    inference: operator ? false : await hasInferenceKey(request),
    loopback: isLocalRequest(request),
  });
  return denial ? adminError(denial.status, denial.code, denial.error) : null;
}
