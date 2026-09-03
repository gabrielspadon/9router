import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { requireAdmin } from "@/lib/admin/guard.js";
import { adminError, adminJson } from "@/lib/admin/policy.js";
import { readAllDrainDocs } from "@/lib/admin/state.js";
import { toConnection } from "@/lib/admin/project.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/admin/qualification — every connection's qualification state.
 *
 * PASSIVE. This reports what the last probe established; it starts no probe and
 * spends no quota, so an operator or a dashboard may poll it. POST
 * .../{connectionId}/recheck is the one operation in this ABI that spends a
 * real generation.
 */
export async function GET(request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const now = Date.now();
    const rows = await getProviderConnections();
    const drains = await readAllDrainDocs();
    const connections = rows.map((conn) =>
      toConnection(conn, { isDraining: Boolean(drains[conn.id]?.isDraining), now }),
    );
    return adminJson({ connections });
  } catch (error) {
    return adminError(500, "state_unavailable", error?.message || "Qualification state could not be read.");
  }
}
