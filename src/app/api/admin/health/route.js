import { requireAdmin } from "@/lib/admin/guard.js";
import { adminJson } from "@/lib/admin/policy.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/admin/health — liveness of the admin ABI itself.
 *
 * Inference class, so an edge caller holding only an inference key can tell a
 * dead process from a refusing one before it tries anything operator-scoped.
 * Deliberately shallow: it touches no database and no upstream, so it answers
 * during a database outage. /api/admin/health/detail carries the diagnosis and
 * is operator-only for exactly that reason.
 */
export async function GET(request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  return adminJson({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    generatedAt: new Date().toISOString(),
  });
}
