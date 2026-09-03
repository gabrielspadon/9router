import { requireAdmin } from "@/lib/admin/guard.js";
import { adminError, adminJson } from "@/lib/admin/policy.js";
import { findReceipt } from "@/lib/admin/receipts.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/admin/receipts/{receiptId} — one switch receipt.
 *
 * 404 also covers a receipt that has aged out of the scan window
 * (src/lib/admin/receipts.js). That is honest: the instance cannot produce it,
 * and a 200 with a partial record would be worse than saying so.
 */
export async function GET(request, { params }) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { receiptId } = await params;
  const receipt = await findReceipt(receiptId);
  if (!receipt) return adminError(404, "not_found", `No receipt with id ${receiptId}.`);

  return adminJson(receipt);
}
