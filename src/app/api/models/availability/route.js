import { NextResponse } from "next/server";
import {
  getProviderConnections,
  updateProviderConnection,
} from "@/lib/localDb";

const MODEL_LOCK_PREFIX = "modelLock_";
const MODEL_FAILURE_PREFIX = "modelFailure_";

function getActiveModelLocks(connection) {
  const now = Date.now();
  return Object.entries(connection)
    .filter(([key, value]) => key.startsWith(MODEL_LOCK_PREFIX) && value)
    .map(([key, value]) => ({
      key,
      model: key.slice(MODEL_LOCK_PREFIX.length) || "__all",
      until: value,
      active: new Date(value).getTime() > now,
    }))
    .filter((lock) => lock.active);
}

export async function GET() {
  try {
    const connections = await getProviderConnections();
    const models = [];

    for (const connection of connections) {
      const locks = getActiveModelLocks(connection);
      for (const lock of locks) {
        models.push({
          provider: connection.provider,
          model: lock.model,
          status: "cooldown",
          until: lock.until,
          connectionId: connection.id,
          connectionName: connection.name || connection.email || connection.id,
          lastError: connection.lastError || null,
        });
      }

      if (locks.length === 0 && connection.testStatus === "unavailable") {
        // testStatus is account-wide but the failure behind it usually is not:
        // an "Invalid model ID" for one model left this reporting __all once its
        // short lock expired, and the dashboard then marked every model on the
        // connection red while showing the one model's error text (#2568).
        //
        // The per-model failure records say which models actually failed. Use
        // them when there are any, and fall back to __all only when the failure
        // genuinely carries no model, which is what an account-level rejection
        // (401, payment required) looks like.
        const failed = Object.keys(connection)
          .filter((key) => key.startsWith(MODEL_FAILURE_PREFIX) && connection[key])
          .map((key) => key.slice(MODEL_FAILURE_PREFIX.length) || "__all");
        const scopedModels = failed.filter((m) => m !== "__all");
        for (const model of scopedModels.length > 0 ? scopedModels : ["__all"]) {
          models.push({
            provider: connection.provider,
            model,
            status: "unavailable",
            connectionId: connection.id,
            connectionName: connection.name || connection.email || connection.id,
            lastError: connection[`${MODEL_FAILURE_PREFIX}${model}`]?.message
              || connection.lastError || null,
          });
        }
      }
    }

    return NextResponse.json({
      models,
      unavailableCount: models.length,
    });
  } catch (error) {
    console.error("[API] Failed to get model availability:", error);
    return NextResponse.json(
      { error: "Failed to fetch model availability" },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const { action, provider, model } = await request.json();

    if (action !== "clearCooldown" || !provider || !model) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const connections = await getProviderConnections({ provider });
    const lockKey = `${MODEL_LOCK_PREFIX}${model}`;

    await Promise.all(
      connections
        .filter((connection) => connection[lockKey])
        .map((connection) =>
          updateProviderConnection(connection.id, {
            [lockKey]: null,
            ...(connection.testStatus === "unavailable"
              ? {
                  testStatus: "active",
                  lastError: null,
                  lastErrorAt: null,
                  backoffLevel: 0,
                }
              : {}),
          }),
        ),
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[API] Failed to clear model cooldown:", error);
    return NextResponse.json(
      { error: "Failed to clear cooldown" },
      { status: 500 },
    );
  }
}
