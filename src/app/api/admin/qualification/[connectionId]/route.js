import { getProviderConnectionById } from "@/lib/db/repos/connectionsRepo.js";
import { getWindows } from "@/lib/db/repos/quotaWindowsRepo.js";
import { requireAdmin } from "@/lib/admin/guard.js";
import { adminError, adminJson } from "@/lib/admin/policy.js";
import { readDrainDoc, readQualification } from "@/lib/admin/state.js";
import { qualificationDetail } from "@/lib/admin/qualification.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/admin/qualification/{connectionId} — one connection's detail.
 *
 * PASSIVE. `generation` reports the LAST probe this instance recorded, not a
 * fresh one, so polling this costs no quota. The shape is identical to what
 * POST .../recheck returns, and only checkedAt distinguishes them: a caller
 * that wants proof-of-now asks for a recheck, everything else reads this.
 */
export async function GET(request, { params }) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { connectionId } = await params;
  const conn = await getProviderConnectionById(connectionId);
  if (!conn) return adminError(404, "not_found", `No connection with id ${connectionId}.`);

  const [drain, probe, windows] = await Promise.all([
    readDrainDoc(connectionId),
    readQualification(connectionId),
    getWindows(connectionId),
  ]);

  return adminJson(qualificationDetail({ conn, drain, probe, windows }));
}
