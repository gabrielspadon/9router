import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { requireAdmin } from "@/lib/admin/guard.js";
import { adminError, adminJson } from "@/lib/admin/policy.js";
import { readAllDrainDocs, toDrainState } from "@/lib/admin/state.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/admin/drain — drain state.
 *
 * Draining connections only by default, because that is the operator's actual
 * question ("what is still bleeding off"). `?all=true` returns every connection,
 * including those that have never been drained, which is the form a dashboard
 * needs to render a toggle per row.
 */
function wantsAll(request) {
  const raw = request.nextUrl?.searchParams?.get("all") ?? (() => {
    try {
      return new URL(request.url).searchParams.get("all");
    } catch {
      return null;
    }
  })();
  // Bare `?all` is a present flag, so it means true. Anything else follows the
  // usual truthy spellings; an unparseable value is false, which is the
  // narrower answer.
  return raw === "" || raw === "true" || raw === "1";
}

export async function GET(request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const docs = await readAllDrainDocs();
    if (!wantsAll(request)) {
      const connections = Object.entries(docs)
        .filter(([, doc]) => doc?.isDraining)
        .map(([connectionId, doc]) => toDrainState(connectionId, doc));
      return adminJson({ connections });
    }
    // Driven by the connection list, not by the kv scope: a connection that has
    // never been drained has no document, and `all` has to include it.
    const conns = await getProviderConnections();
    const connections = conns.map((conn) => toDrainState(conn.id, docs[conn.id] ?? null));
    return adminJson({ connections });
  } catch (error) {
    return adminError(500, "state_unavailable", error?.message || "Drain state could not be read.");
  }
}
