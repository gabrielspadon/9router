import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import { pingModelByKind } from "@/app/api/models/test/ping";
import { peekRotatedModels } from "open-sse/services/combo.js";

/**
 * POST /api/combos/test - Test ad-hoc / unsaved combo fallback execution
 * Accepts JSON body: { name?: string, models: string[], kind?: string, prompt?: string, mode?: "fallback" | "all" }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { name = "Ad-hoc Combo", models = [], kind = "llm", prompt = null, mode = "fallback" } = body;

    if (!Array.isArray(models) || models.length === 0) {
      return NextResponse.json({ error: "Models array is required and cannot be empty" }, { status: 400 });
    }

    const settings = await getSettings();
    const comboStrategies = settings.comboStrategies || {};
    const comboConfig = comboStrategies[name] || {};
    const strategy = comboConfig.fallbackStrategy || settings.comboStrategy || "fallback";

    let orderedModels = [...models];
    if (strategy === "round-robin") {
      // Peek, never consume: this endpoint only shows what the order WOULD be,
      // and advancing the cursor here would shift live round-robin for real
      // traffic every time someone pressed Test (#3404).
      orderedModels = peekRotatedModels(models, name, "round-robin");
    }

    // Self-call the port this request actually arrived on. Reconstructing it from
    // process.env.PORT breaks whenever the server was started without PORT in its
    // environment: the fallback is the 20128 default, the fetch is refused, and
    // the throw used to surface as a bare 500 for the whole combo (#1874).
    const requestPort = (() => {
      try { return new URL(request.url).port; } catch { return ""; }
    })();
    const baseUrl = `http://127.0.0.1:${requestPort || process.env.PORT || UPDATER_CONFIG.appPort}`;
    const steps = [];
    let comboStatus = "failed";
    let servingModel = null;
    let servedStepIndex = null;

    for (let i = 0; i < orderedModels.length; i++) {
      const modelStr = orderedModels[i];
      // A member that THROWS (connection refused, timeout, DNS) must fail its own
      // step, not the whole test. Collapsing it into the outer catch returned a
      // bare 500 with no indication of which model failed or why, while testing
      // the same providers individually returned 200 because that path calls the
      // upstream directly instead of self-calling the gateway (#1874).
      let pingRes;
      try {
        pingRes = await pingModelByKind(modelStr, kind, baseUrl, prompt);
      } catch (err) {
        pingRes = { ok: false, status: 0, latencyMs: null, error: `Ping threw: ${err?.message || String(err)}` };
      }

      if (pingRes.ok) {
        steps.push({
          index: i + 1,
          model: modelStr,
          ok: true,
          status: pingRes.status || 200,
          latencyMs: pingRes.latencyMs,
          error: null,
          preview: pingRes.preview || null,
          fallbackTriggered: false,
          servedRequest: true,
          skipped: false,
        });

        if (comboStatus === "failed") {
          comboStatus = "success";
          servingModel = modelStr;
          servedStepIndex = i + 1;
        }

        if (mode === "fallback") {
          for (let j = i + 1; j < orderedModels.length; j++) {
            steps.push({
              index: j + 1,
              model: orderedModels[j],
              ok: false,
              skipped: true,
              reason: `Skipped: Fallback satisfied by step #${i + 1} (${modelStr})`,
            });
          }
          break;
        }
      } else {
        steps.push({
          index: i + 1,
          model: modelStr,
          ok: false,
          status: pingRes.status || 500,
          latencyMs: pingRes.latencyMs,
          error: pingRes.error || "Model ping failed",
          preview: null,
          fallbackTriggered: true,
          servedRequest: false,
          skipped: false,
        });
      }
    }

    return NextResponse.json({
      comboName: name,
      kind,
      strategy,
      mode,
      comboStatus,
      servingModel,
      servedStepIndex,
      totalLatencyMs: steps.reduce((acc, s) => acc + (s.latencyMs || 0), 0),
      steps,
    });
  } catch (error) {
    console.log("Error testing ad-hoc combo:", error);
    return NextResponse.json({ error: "Failed to test combo execution" }, { status: 500 });
  }
}
