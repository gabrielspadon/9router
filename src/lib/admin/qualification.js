import { connectionStatus, redactError, toWindowRecords } from "./project.js";

/**
 * QualificationDetail assembly, shared by the GET and the recheck POST so the
 * two cannot drift into reporting the same connection differently.
 *
 * The `generation` object is the ABI's credential-safe evidence: whether a real
 * completion succeeded, against which model, how long it took, and a redacted
 * reason if not. Never the generated content, and never the probe's request or
 * response body.
 */
export function qualificationDetail({ conn, drain, probe, windows, now = Date.now() }) {
  const base = connectionStatus(conn, { isDraining: Boolean(drain?.isDraining), now });
  return {
    connectionId: conn.id,
    provider: conn.provider,
    // "error" is the ABI's one status beyond the Connection enum, and it is
    // narrower than "degraded": the connection's last probe actually failed,
    // as opposed to it being rate-limited or disabled.
    status: base === "degraded" && conn.testStatus === "error" ? "error" : base,
    checkedAt: probe?.checkedAt ?? conn.lastErrorAt ?? conn.updatedAt ?? null,
    generation: {
      // Only a completed probe proves generation. An absent record means no
      // probe has run in this instance, which is false, not null: the ABI
      // types ok as a boolean, and "unproven" is not "proven working".
      ok: probe ? Boolean(probe.ok) : conn.testStatus === "active",
      model: probe?.model ?? null,
      latencyMs: Number.isFinite(probe?.latencyMs) ? probe.latencyMs : null,
      error: redactError(probe?.error ?? conn.lastError),
    },
    quota: toWindowRecords(windows),
  };
}
