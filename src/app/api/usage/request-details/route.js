import { NextResponse } from "next/server";
import { getRequestDetails } from "@/lib/usageDb";
import { isObservabilityEnabled } from "@/lib/requestDetailsDb";
import { redactSecrets, redactSecretsText } from "open-sse/utils/redact.js";

// Upstream error text is diagnostics, not conversation. Cap it anyway: a
// provider can echo a slice of the offending request back in its message.
const MAX_ERROR_CHARS = 2000;

/**
 * Redact conversation payloads: the stored details include full request bodies
 * (user prompts, tool calls) and provider responses. Returning them wholesale
 * lets any dashboard-authenticated user (or, if requireLogin is disabled,
 * anyone) read every user's conversation history. Keep the metadata (model,
 * tokens, latency, status) but drop message content.
 *
 * The one exception is the error envelope on a failed request. chatCore's
 * failure paths store `response: { error, status }` carrying the upstream
 * refusal verbatim (open-sse/handlers/chatCore.js:855 transport, :1176 HTTP) —
 * the only surviving record of WHY a request failed, since `appendRequestLog`
 * is a no-op and `saveUsageStats` skips a zero-token request, so nothing about
 * the failure reaches usageHistory or /api/usage/logs at all. Blanking it left
 * an operator with a red row and no way to see the "not_found_error" or
 * "rate_limit_error" behind it (#2221). Keep those two fields, still dropping
 * every other response field and every request body.
 */
export function redactDetail(detail) {
  // Deep-redact FIRST, over the whole record. The blanking loop below only knows
  // the four body fields, so every other field — `pxpipe`, and whatever is added
  // beside it next — reached the reader verbatim. Rows written before
  // requestDetailsRepo started scrubbing at write time are still in the table, so
  // this pass is the only thing between them and a reader.
  const redacted = redactSecrets(detail);
  for (const key of ["request", "providerRequest", "providerResponse", "response"]) {
    if (redacted[key] === undefined) continue;
    const err = key === "response" ? redacted[key]?.error : undefined;
    if (err === undefined || err === null) {
      redacted[key] = { redacted: true };
      continue;
    }
    // The stored value is already scrubbed at write time
    // (requestDetailsRepo.redactAndTruncate), so this second pass exists for rows
    // written before that landed: the projection is the only thing standing
    // between an old row and a reader.
    const text = redactSecretsText(typeof err === "string" ? err : JSON.stringify(err));
    redacted[key] = {
      redacted: true,
      error: text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS)}…` : text,
      status: redacted[key].status ?? null,
    };
  }
  return redacted;
}

/**
 * GET /api/usage/request-details
 * Query parameters: page, pageSize (1-100), provider, model, connectionId, status, startDate, endDate
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    
    const pageRaw = parseInt(searchParams.get("page"));
    const page = Number.isNaN(pageRaw) ? 1 : pageRaw;
    const pageSizeRaw = parseInt(searchParams.get("pageSize"));
    const pageSize = Number.isNaN(pageSizeRaw) ? 20 : pageSizeRaw;
    const provider = searchParams.get("provider");
    const model = searchParams.get("model");
    const connectionId = searchParams.get("connectionId");
    const status = searchParams.get("status");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    
    if (page < 1) {
      return NextResponse.json(
        { error: "Page must be >= 1" },
        { status: 400 }
      );
    }
    
    if (pageSize < 1 || pageSize > 100) {
      return NextResponse.json(
        { error: "PageSize must be between 1 and 100" },
        { status: 400 }
      );
    }
    
    const filter = {
      page,
      pageSize
    };
    
    if (provider) filter.provider = provider;
    if (model) filter.model = model;
    if (connectionId) filter.connectionId = connectionId;
    if (status) filter.status = status;
    if (startDate) filter.startDate = startDate;
    if (endDate) filter.endDate = endDate;
    
    const result = await getRequestDetails(filter);

    const redactedDetails = (result.details || []).map(redactDetail);

    // An empty page means one of two very different things: nothing matched, or
    // request-detail recording is off — which it is by default since v0.5.50, so
    // an install that used to fill this tab now reads as broken (#3106). Say
    // which, instead of leaving the reader to guess. An unreadable setting is
    // reported as off rather than costing the reader their results.
    const observability = { enabled: await isObservabilityEnabled().catch(() => false) };

    return NextResponse.json({ ...result, details: redactedDetails, observability });
  } catch (error) {
    console.error("[API] Failed to get request details:", error);
    return NextResponse.json(
      { error: "Failed to fetch request details" },
      { status: 500 }
    );
  }
}
