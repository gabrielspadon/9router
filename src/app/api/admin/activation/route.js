import { requireAdmin } from "@/lib/admin/guard.js";
import { adminError, adminJson, invalidIfMatch, parseAdminBody } from "@/lib/admin/policy.js";
import {
  activeRelease,
  commitActivation,
  findRelease,
  releaseCatalog,
  toRelease,
  versionOf,
} from "@/lib/admin/state.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET and POST /api/admin/activation — which release is serving traffic.
 *
 * WHAT A RELEASE IS HERE. The frozen ABI has no create-release operation, so a
 * release becomes known by being activated: history IS the catalog, and an
 * unknown releaseId is a 404 rather than an implicit create. That is the
 * conservative reading and the safe one — an operator cannot typo a release
 * into existence and cut traffic over to it.
 *
 * The one release that exists without ever having been activated through this
 * endpoint is the build currently running, derived from the app version. It is
 * synthesized on read rather than written, so a GET stays a pure read.
 */
export async function GET(request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const current = await activeRelease();
    const history = await releaseCatalog();
    return adminJson({
      active: toRelease(current, current),
      history: history.map((entry) => toRelease(entry, current)),
    });
  } catch (error) {
    return adminError(500, "state_unavailable", error?.message || "Activation state could not be read.");
  }
}

export async function POST(request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const parsed = await parseAdminBody(request, ["releaseId", "ifMatch"]);
  if (parsed.error) return adminError(400, "invalid_request", parsed.error);
  const { releaseId, ifMatch } = parsed.body;
  if (typeof releaseId !== "string" || !releaseId) {
    return adminError(400, "invalid_request", "releaseId is required and must be a non-empty string.");
  }
  if (invalidIfMatch(ifMatch)) return adminError(400, "invalid_request", "ifMatch must be a string.");

  const current = await activeRelease();
  if (ifMatch !== undefined && ifMatch !== versionOf(current)) {
    return adminError(412, "version_conflict", "ifMatch does not match the active release's concurrencyVersion.", {
      currentVersion: versionOf(current),
    });
  }

  const target = await findRelease(releaseId);
  if (!target) return adminError(404, "not_found", `No release with id ${releaseId}.`);
  // The precondition the ABI names: a release that failed its build or
  // qualification is on file precisely so it can be refused by id, which a 404
  // would not distinguish from a typo.
  if (target.status === "failed") {
    return adminError(409, "precondition_failed", `Release ${releaseId} has not passed its build and qualification precondition.`);
  }

  if (current?.releaseId === releaseId && current.status === "active") {
    return adminJson(toRelease(current, current));
  }

  const next = {
    releaseId,
    version: target.version ?? releaseId,
    status: "active",
    activatedAt: new Date().toISOString(),
    // The release being replaced, which is what a later rollback with no
    // explicit target walks back to.
    previousReleaseId: current?.releaseId ?? null,
  };
  await commitActivation(next, "activate");
  return adminJson(toRelease(next, next));
}
