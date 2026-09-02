import { NextResponse } from "next/server";
import { FILTERS } from "./filters.js";
import REGISTRY from "open-sse/providers/registry/index.js";

export const dynamic = "force-dynamic";

function isTrustedModelsSource(type, url) {
  return REGISTRY.some((provider) =>
    provider.modelsFetcher?.type === type && provider.modelsFetcher.url === url
  );
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const type = searchParams.get("type");

  if (!url || !type) {
    return NextResponse.json({ error: "Missing url or type" }, { status: 400 });
  }

  const filter = FILTERS[type];
  if (!filter) {
    return NextResponse.json({ error: "Unknown filter type" }, { status: 400 });
  }

  if (!isTrustedModelsSource(type, url)) {
    return NextResponse.json({ error: "URL not allowed" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "manual" });
    if (!res.ok) {
      return NextResponse.json({ data: [] });
    }
    const json = await res.json();
    const raw = json.data ?? json.models ?? json;
    const data = filter(Array.isArray(raw) ? raw : []);
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ data: [] });
  } finally {
    clearTimeout(timeout);
  }
}
