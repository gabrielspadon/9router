import { NextResponse } from "next/server";
import { pingModelByKind } from "./ping";

// POST /api/models/test - Ping one model, or several at once with `models`.
// { model, kind } answers exactly as before. { models: [...], kind } pings each
// and returns one result per model (#3430), sequentially rather than in
// parallel: a batch is usually the same upstream, and a burst is what trips its
// rate limiter and turns healthy models into failures.
export async function POST(request) {
  try {
    const { model, models, kind, prompt } = await request.json();
    const list = Array.isArray(models) ? models.filter((m) => m) : null;
    if (!model && !list?.length) {
      return NextResponse.json({ error: "Model required" }, { status: 400 });
    }
    // A caller-supplied prompt makes this the playground the reports ask for
    // (#3438, #3140): the same prompt against one model, or against several so
    // the answers can be compared side by side. The response text already comes
    // back as `preview`. Anything that is not a non-empty string falls back to
    // the fixed probe, so an empty box still tests reachability.
    const userPrompt = typeof prompt === "string" && prompt.trim() ? prompt : null;
    // undefined keeps pingModelByKind own loopback default: baseUrl is its third
    // parameter and the prompt is the fourth.
    if (!list) {
      const result = await pingModelByKind(model, kind || "llm", undefined, userPrompt);
      return NextResponse.json(result);
    }
    const results = [];
    for (const m of list) {
      try {
        results.push({ model: m, ...(await pingModelByKind(m, kind || "llm", undefined, userPrompt)) });
      } catch (err) {
        results.push({ model: m, ok: false, error: err.message });
      }
    }
    return NextResponse.json({ results, ok: results.every((r) => r.ok) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
