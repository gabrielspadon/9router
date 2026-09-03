import { requireAdmin } from "@/lib/admin/guard.js";
import { adminError, adminJson, invalidIfMatch, parseAdminBody } from "@/lib/admin/policy.js";
import { activeRelease, commitActivation, findRelease, toRelease, versionOf } from "@/lib/admin/state.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/admin/rollback — go back to the previously active release.
 *
 * WITH NO BODY it walks the active release's own previousReleaseId, which is
 * the operator's "undo that". With toReleaseId it goes to a named release
 * instead, which is what a chain of bad activations needs — walking back one
 * step at a time would re-activate the release that was already rejected.
 *
 * 409 IS THE HONEST ANSWER TO "nothing to roll back to". Not 400, because the
 * request was well formed, and not 404, because no id was given to miss. The
 * ABI names no_prior_release for exactly this.
 */
export async function POST(request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const parsed = await parseAdminBody(request, ["toReleaseId", "ifMatch"]);
  if (parsed.error) return adminError(400, "invalid_request", parsed.error);
  const { toReleaseId, ifMatch } = parsed.body;
  if (toReleaseId !== undefined && (typeof toReleaseId !== "string" || !toReleaseId)) {
    return adminError(400, "invalid_request", "toReleaseId must be a non-empty string when present.");
  }
  if (invalidIfMatch(ifMatch)) return adminError(400, "invalid_request", "ifMatch must be a string.");

  const current = await activeRelease();
  if (ifMatch !== undefined && ifMatch !== versionOf(current)) {
    return adminError(412, "version_conflict", "ifMatch does not match the active release's concurrencyVersion.", {
      currentVersion: versionOf(current),
    });
  }

  const targetId = toReleaseId ?? current?.previousReleaseId ?? null;
  if (!targetId) {
    return adminError(409, "no_prior_release", "No previousReleaseId on file and no toReleaseId given: nothing to roll back to.");
  }

  const target = await findRelease(targetId);
  if (!target) return adminError(404, "not_found", `No release with id ${targetId}.`);

  const next = {
    releaseId: target.releaseId,
    version: target.version ?? target.releaseId,
    status: "active",
    activatedAt: new Date().toISOString(),
    // The release being rolled back FROM. A second rollback therefore returns
    // to where this one started rather than dead-ending, which is what makes a
    // rollback recoverable from itself.
    previousReleaseId: current?.releaseId ?? null,
  };
  // One transaction: the new active release, its history entry, and the
  // outgoing release's rolled_back status all land together or not at all.
  await commitActivation(next, "rollback", current);
  return adminJson(toRelease(next, next));
}
