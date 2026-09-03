import { NextResponse } from 'next/server';

/**
 * Auth classification for the frozen admin ABI (docs/reconciliation/admin-abi.json).
 *
 * PURE DECISION, TWO COLLECTORS. The verdict lives here once and is reached
 * from two places: src/dashboardGuard.js, which runs as middleware and is the
 * boundary the contract's `byteIdenticalOnRejection` clause names, and
 * src/lib/admin/guard.js, which every /api/admin route calls. Both hand this
 * module the same four booleans, so the two gates cannot drift into disagreeing
 * about who may call what. Nothing here reads a credential, a cookie or the
 * database — that is deliberately the collectors' job, because the middleware
 * and a route resolve those from different objects.
 */

export const ADMIN_PREFIX = '/api/admin';

// The contract's ErrorResponse.source is a const, and it is NOT the
// dashboardGuard's "tokenproxy": a caller must be able to tell an admin-ABI
// refusal from a gateway refusal on the same socket.
export const ADMIN_ERROR_SOURCE = 'tokenproxy-admin';

// The two operations an edge caller needs BEFORE it has done anything
// operator-scoped: liveness, and the catalog it picks a model from. Exact
// matches, never a prefix — /api/admin/health/detail sits one segment below
// /api/admin/health and is operator-class, so a prefix test here would hand an
// inference key the per-connection degradation detail.
const INFERENCE_CLASS_PATHS = new Set([`${ADMIN_PREFIX}/health`, `${ADMIN_PREFIX}/models`]);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalizePath(pathname) {
  const p = typeof pathname === 'string' ? pathname : '';
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

export function isAdminPath(pathname) {
  const p = normalizePath(pathname);
  return p === ADMIN_PREFIX || p.startsWith(`${ADMIN_PREFIX}/`);
}

export function adminAuthClass(pathname) {
  return INFERENCE_CLASS_PATHS.has(normalizePath(pathname)) ? 'inference' : 'operator';
}

export function isAdminMutation(method) {
  return !READ_METHODS.has(String(method || 'GET').toUpperCase());
}

/**
 * The whole authorization verdict for one admin request.
 *
 * @param {object} facts
 * @param {"inference"|"operator"} facts.authClass
 * @param {boolean} facts.mutating - state-changing, so also loopback-bound.
 * @param {boolean} facts.operator - CLI token or a signed-in dashboard session.
 *   Deliberately NOT satisfied by requireLogin=false: these endpoints move
 *   account, quota and release state, so they follow the ALWAYS_PROTECTED gate
 *   rather than the requireLogin escape hatch PROTECTED_API_PATHS allows.
 * @param {boolean} facts.inference - a valid inference API key was presented.
 * @param {boolean} facts.loopback - isLocalRequest() would accept this caller.
 * @returns {null|{status: number, code: string, error: string}} null to allow.
 */
export function adminDecision({ authClass, mutating, operator, inference, loopback }) {
  if (authClass === 'inference') {
    if (operator || inference || loopback) return null;
    return {
      status: 401,
      code: 'unauthorized',
      error: 'An inference API key or a loopback origin is required for this endpoint.',
    };
  }

  // Operator class. An inference key is never enough, and the difference
  // between "no credential" and "the wrong class of credential" is the only
  // thing separating the two refusals — same body shape, different status.
  if (!operator) {
    return inference
      ? {
          status: 403,
          code: 'forbidden_class',
          error:
            'An operator credential is required. An inference API key does not satisfy this endpoint.',
        }
      : {
          status: 401,
          code: 'unauthorized',
          error: 'An operator credential (CLI token or dashboard session) is required.',
        };
  }

  if (mutating && !loopback) {
    return {
      status: 403,
      code: 'forbidden_loopback',
      error:
        'State-changing admin endpoints are loopback-bound. Reach them through a tunnel that terminates as a loopback peer.',
    };
  }

  return null;
}

export function adminError(status, code, error, extra = null) {
  return NextResponse.json(
    { error, code, source: ADMIN_ERROR_SOURCE, ...(extra || {}) },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

export function adminJson(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Read and validate a mutation's request body, in that order and before any
 * state read (admin-abi.md, "Failure direction": a field with the wrong type or
 * an unrecognized field is 400 BEFORE the handler touches drain, activation or
 * rollback state).
 *
 * @param {Request} request
 * @param {string[]} allowed - the complete set of recognized field names.
 * @returns {Promise<{body: object}|{error: string}>}
 */
export async function parseAdminBody(request, allowed) {
  let raw;
  try {
    raw = await request.text();
  } catch {
    return { error: 'Request body could not be read.' };
  }
  if (!raw || !raw.trim()) return { body: {} };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'Request body is not valid JSON.' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'Request body must be a JSON object.' };
  }
  for (const key of Object.keys(parsed)) {
    if (!allowed.includes(key)) return { error: `Unrecognized field: ${key}` };
  }
  return { body: parsed };
}

// ifMatch is optional everywhere it appears, so "absent" and "present but not a
// string" are different answers: the first is a caller with no prior read, the
// second is a malformed request.
export function invalidIfMatch(value) {
  return value !== undefined && typeof value !== 'string';
}
