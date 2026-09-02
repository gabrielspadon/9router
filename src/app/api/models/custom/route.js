import { NextResponse } from "next/server";
import { getCustomModels, addCustomModel, deleteCustomModel } from "@/models";
import { refreshModelCapabilityOverrides } from "@/lib/modelCapabilityOverrides";

export const dynamic = "force-dynamic";

// GET /api/models/custom - List all custom models
export async function GET() {
  try {
    const models = await getCustomModels();
    return NextResponse.json({ models });
  } catch (error) {
    console.log("Error fetching custom models:", error);
    return NextResponse.json({ error: "Failed to fetch custom models" }, { status: 500 });
  }
}

// One model payload in, either a validated record or the reason it was refused.
// Shared by the single and batch shapes so a batch entry cannot slip past a
// check the single shape applies.
function readModelPayload(body) {
  const { providerAlias, id, type, name, vision } = body || {};
  // Accept the snake_case spelling too. The report was of the fields being
  // "silently dropped", and that is what happens to a caller using the
  // OpenAI-style names against a route that only reads camelCase: no error,
  // no override, and nothing to tell them why (#1294).
  // Presence, not nullishness: `??` would let an explicit null fall through to
  // the alias and out the other side as undefined, skipping the guard below
  // that rejects it. The alias is a spelling fallback, never a way past
  // validation.
  const maxInputTokens = body && "maxInputTokens" in body ? body.maxInputTokens : body?.max_input_tokens;
  const maxOutputTokens = body && "maxOutputTokens" in body ? body.maxOutputTokens : body?.max_output_tokens;
  if (!providerAlias || !id) {
    return { error: "providerAlias and id required" };
  }
  for (const [field, value] of Object.entries({ maxInputTokens, maxOutputTokens })) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      return { error: `${field} must be a positive integer` };
    }
  }
  if (vision !== undefined && typeof vision !== "boolean") {
    return { error: "vision must be a boolean" };
  }
  return { model: { providerAlias, id, type: type || "llm", name, maxInputTokens, maxOutputTokens, vision } };
}

// A provider catalogue is imported in one request, not one per model. DELETE
// already took a batch; POST did not, so "Import Models" could only be built as
// N round trips against a route that rewrites the capability overrides on every
// one of them (#1030).
const MAX_IMPORT_BATCH = 1000;

// POST /api/models/custom - Add one custom model, or a batch via { models: [...] }
export async function POST(request) {
  try {
    const body = await request.json();

    if (Array.isArray(body?.models)) {
      if (body.models.length === 0) {
        return NextResponse.json({ error: "models[] must not be empty" }, { status: 400 });
      }
      if (body.models.length > MAX_IMPORT_BATCH) {
        return NextResponse.json(
          { error: `models[] must hold at most ${MAX_IMPORT_BATCH} entries` },
          { status: 400 },
        );
      }
      // Per-entry results rather than one verdict, matching DELETE: an import
      // where some models are already registered is a partial success, and
      // failing the whole request would send the caller looking for a problem
      // that is not there.
      const results = [];
      for (const entry of body.models) {
        const { model, error } = readModelPayload(entry);
        if (error) {
          results.push({ id: entry?.id ?? null, success: false, error });
          continue;
        }
        try {
          results.push({ id: model.id, success: true, added: await addCustomModel(model) });
        } catch (err) {
          results.push({ id: model.id, success: false, error: String(err?.message || err) });
        }
      }
      // Once for the batch, not once per model.
      await refreshModelCapabilityOverrides();
      const failed = results.filter((r) => !r.success);
      return NextResponse.json({
        success: failed.length === 0,
        added: results.filter((r) => r.added).length,
        results,
      });
    }

    const { model, error } = readModelPayload(body);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }
    const added = await addCustomModel(model);
    await refreshModelCapabilityOverrides();
    return NextResponse.json({ success: true, added });
  } catch (error) {
    console.log("Error adding custom model:", error);
    return NextResponse.json({ error: "Failed to add custom model" }, { status: 500 });
  }
}

// DELETE /api/models/custom?providerAlias=xxx&id=yyy&type=zzz
// Repeat `id` to delete several at once: ?providerAlias=xxx&id=a&id=b. Clearing
// a page of models one request at a time is what the batch request in #3430 is
// about, and `ids` is already the plural shape /api/models/disabled uses.
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    const ids = searchParams.getAll("id").filter((v) => v);
    const type = searchParams.get("type") || "llm";
    if (!providerAlias || !ids.length) {
      return NextResponse.json({ error: "providerAlias and id required" }, { status: 400 });
    }
    // Per-id results rather than one verdict: a batch where one id was already
    // gone is a partial success, and reporting it as a single failure would
    // send the caller looking for a problem that is not there.
    const results = [];
    for (const id of ids) {
      try {
        await deleteCustomModel({ providerAlias, id, type });
        results.push({ id, success: true });
      } catch (error) {
        results.push({ id, success: false, error: String(error?.message || error) });
      }
    }
    await refreshModelCapabilityOverrides();
    const failed = results.filter((r) => !r.success);
    return NextResponse.json({
      success: failed.length === 0,
      deleted: results.length - failed.length,
      results,
    });
  } catch (error) {
    console.log("Error deleting custom model:", error);
    return NextResponse.json({ error: "Failed to delete custom model" }, { status: 500 });
  }
}
