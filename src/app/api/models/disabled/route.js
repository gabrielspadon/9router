import { NextResponse } from "next/server";
import { getDisabledModels, getDisabledByProvider, disableModels, enableModels } from "@/lib/disabledModelsDb";

export const dynamic = "force-dynamic";

// GET /api/models/disabled?providerAlias=xxx[&connectionId=yyy]
// With connectionId: that account's own set, falling back to the provider-wide
// one while the account has never been edited (#1527).
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    const connectionId = searchParams.get("connectionId");
    if (providerAlias) {
      return NextResponse.json({ ids: await getDisabledByProvider(providerAlias, connectionId) });
    }
    return NextResponse.json({ disabled: await getDisabledModels() });
  } catch (error) {
    console.log("Error fetching disabled models:", error);
    return NextResponse.json({ error: "Failed to fetch disabled models" }, { status: 500 });
  }
}

// POST /api/models/disabled  body: { providerAlias, ids: [...], connectionId? }
export async function POST(request) {
  try {
    const { providerAlias, ids, connectionId } = await request.json();
    if (!providerAlias || !Array.isArray(ids)) {
      return NextResponse.json({ error: "providerAlias and ids[] required" }, { status: 400 });
    }
    await disableModels(providerAlias, ids, connectionId || null);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error disabling models:", error);
    return NextResponse.json({ error: "Failed to disable models" }, { status: 500 });
  }
}

// DELETE /api/models/disabled?providerAlias=xxx[&id=yyy][&connectionId=zzz]
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    const id = searchParams.get("id");
    const connectionId = searchParams.get("connectionId");
    if (!providerAlias) {
      return NextResponse.json({ error: "providerAlias required" }, { status: 400 });
    }
    await enableModels(providerAlias, id ? [id] : [], connectionId || null);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error enabling models:", error);
    return NextResponse.json({ error: "Failed to enable models" }, { status: 500 });
  }
}
