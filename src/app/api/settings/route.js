import { NextResponse } from "next/server";
import { getProxyPoolById, getSettings, updateProviderStrategy, updateSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { resetComboRotation } from "open-sse/services/combo.js";
import { isValidConnectTimeoutMs } from "open-sse/config/connectTimeout.js";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store"
};

// Secrets must never be mass-assigned from request body (CWE-915)
const PROTECTED_SETTING_KEYS = ["password", "mitmSudoEncrypted"];
const DANGEROUS_STRATEGY_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const NOAUTH_LEGACY_PROXY_KEYS = new Set([
  "connectionProxyMode",
  "connectionProxyEnabled",
  "connectionProxyUrl",
  "connectionNoProxy",
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasInvalidCodexFastMode(providerId, values, { allowNull = false } = {}) {
  if (providerId !== "codex" || !Object.prototype.hasOwnProperty.call(values, "fastMode")) {
    return false;
  }
  return typeof values.fastMode !== "boolean" && !(allowNull && values.fastMode === null);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function normalizeProviderStrategyProxySelection(values) {
  if ([...NOAUTH_LEGACY_PROXY_KEYS].some((key) => Object.prototype.hasOwnProperty.call(values, key))) {
    return { error: "Connection proxy fields are not valid for provider strategies" };
  }
  if (Object.prototype.hasOwnProperty.call(values, "strictProxy")) {
    return { error: "Provider strategy strictness is server-managed" };
  }
  if (!Object.prototype.hasOwnProperty.call(values, "proxyPoolId")) {
    return { values };
  }
  const proxyPoolId = values.proxyPoolId;
  if (proxyPoolId === null || proxyPoolId === undefined || proxyPoolId === "" || proxyPoolId === "__none__") {
    return { values: { ...values, proxyPoolId: null, strictProxy: null } };
  }
  const normalizedId = normalizeString(String(proxyPoolId));
  if (!normalizedId) {
    return { values: { ...values, proxyPoolId: null, strictProxy: null } };
  }
  const pool = await getProxyPoolById(normalizedId);
  if (!pool?.isActive || !normalizeString(pool.proxyUrl)) {
    return { error: "Active proxy pool not found" };
  }
  return {
    values: {
      ...values,
      proxyPoolId: pool.id,
      strictProxy: pool.strictProxy === true,
    },
  };
}

async function normalizeProviderStrategies(strategies) {
  const normalized = {};
  for (const [providerId, values] of Object.entries(strategies)) {
    const selection = await normalizeProviderStrategyProxySelection(values);
    if (selection.error) return selection;
    normalized[providerId] = selection.values;
  }
  return { strategies: normalized };
}

function toSafeSettings(settings) {
  const safeSettings = { ...settings };
  const oidcClientSecret = safeSettings.oidcClientSecret;
  delete safeSettings.password;
  delete safeSettings.oidcClientSecret;
  safeSettings.oidcConfigured = !!(
    safeSettings.oidcIssuerUrl
    && safeSettings.oidcClientId
    && oidcClientSecret
  );
  return safeSettings;
}

export async function GET() {
  try {
    const settings = await getSettings();
    const safeSettings = toSafeSettings(settings);
    
    const enableRequestLogs = process.env.ENABLE_REQUEST_LOGS === "true";
    const enableTranslator = process.env.ENABLE_TRANSLATOR === "true";
    
    return NextResponse.json({ 
      ...safeSettings, 
      enableRequestLogs,
      enableTranslator,
      hasPassword: !!settings.password
    }, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error getting settings:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();

    if (Object.prototype.hasOwnProperty.call(body, "providerStrategyPatch")) {
      if (Object.keys(body).length !== 1) {
        return NextResponse.json(
          { error: "providerStrategyPatch cannot be combined with other settings" },
          { status: 400 },
        );
      }
      const patch = body.providerStrategyPatch;
      const providerId = typeof patch?.providerId === "string" ? patch.providerId.trim() : "";
      const values = patch?.values;
      if (
        !providerId
        || providerId.length > 128
        || DANGEROUS_STRATEGY_KEYS.has(providerId)
        || !isPlainObject(values)
      ) {
        return NextResponse.json({ error: "Invalid provider strategy patch" }, { status: 400 });
      }
      if ([...DANGEROUS_STRATEGY_KEYS].some((key) =>
        Object.prototype.hasOwnProperty.call(values, key))) {
        return NextResponse.json({ error: "Invalid provider strategy key" }, { status: 400 });
      }
      if (Object.prototype.hasOwnProperty.call(values, "connectTimeoutMs")
          && values.connectTimeoutMs !== null
          && !isValidConnectTimeoutMs(values.connectTimeoutMs)) {
        return NextResponse.json(
          { error: "connectTimeoutMs must be an integer from 1000 through 120000" },
          { status: 400 },
        );
      }
      if (hasInvalidCodexFastMode(providerId, values, { allowNull: true })) {
        return NextResponse.json(
          { error: "codex.fastMode must be a boolean or null" },
          { status: 400 },
        );
      }
      const normalizedSelection = await normalizeProviderStrategyProxySelection(values);
      if (normalizedSelection.error) {
        return NextResponse.json({ error: normalizedSelection.error }, { status: 400 });
      }
      const settings = await updateProviderStrategy(providerId, normalizedSelection.values);
      return NextResponse.json(toSafeSettings(settings), { headers: SETTINGS_RESPONSE_HEADERS });
    }

    if (Object.prototype.hasOwnProperty.call(body, "connectTimeoutMs")
        && !isValidConnectTimeoutMs(body.connectTimeoutMs)) {
      return NextResponse.json(
        { error: "connectTimeoutMs must be an integer from 1000 through 120000" },
        { status: 400 },
      );
    }

    if (Object.prototype.hasOwnProperty.call(body, "providerStrategies")) {
      const strategies = body.providerStrategies;
      if (!isPlainObject(strategies)) {
        return NextResponse.json({ error: "Invalid provider strategies" }, { status: 400 });
      }
      for (const [providerId, values] of Object.entries(strategies)) {
        if (DANGEROUS_STRATEGY_KEYS.has(providerId) || !isPlainObject(values)) {
          return NextResponse.json({ error: "Invalid provider strategy" }, { status: 400 });
        }
        if ([...DANGEROUS_STRATEGY_KEYS].some((key) =>
          Object.prototype.hasOwnProperty.call(values, key))) {
          return NextResponse.json({ error: "Invalid provider strategy key" }, { status: 400 });
        }
        if (Object.prototype.hasOwnProperty.call(values, "connectTimeoutMs")
            && !isValidConnectTimeoutMs(values.connectTimeoutMs)) {
          return NextResponse.json(
            { error: "connectTimeoutMs must be an integer from 1000 through 120000" },
            { status: 400 },
          );
        }
        if (hasInvalidCodexFastMode(providerId, values)) {
          return NextResponse.json(
            { error: "codex.fastMode must be a boolean" },
            { status: 400 },
          );
        }
      }
      const normalizedStrategies = await normalizeProviderStrategies(strategies);
      if (normalizedStrategies.error) {
        return NextResponse.json({ error: normalizedStrategies.error }, { status: 400 });
      }
      body.providerStrategies = normalizedStrategies.strategies;
    }

    // Strip protected secrets before any internal handling sets them
    for (const key of PROTECTED_SETTING_KEYS) delete body[key];

    // If updating password, hash it
    if (body.newPassword) {
      const settings = await getSettings();
      const currentHash = settings.password;

      // Verify current password if it exists
      if (currentHash) {
        if (!body.currentPassword) {
          return NextResponse.json({ error: "Current password required" }, { status: 400 });
        }
        const isValid = await bcrypt.compare(body.currentPassword, currentHash);
        if (!isValid) {
          return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      } else {
        // First time setting password, no current password needed
        // Allow empty currentPassword or default "123456"
        if (body.currentPassword && body.currentPassword !== "123456") {
           return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      }

      const salt = await bcrypt.genSalt(10);
      body.password = await bcrypt.hash(body.newPassword, salt);
      delete body.newPassword;
      delete body.currentPassword;
    }

    if (Object.prototype.hasOwnProperty.call(body, "oidcClientSecret")) {
      if (!body.oidcClientSecret || !String(body.oidcClientSecret).trim()) {
        delete body.oidcClientSecret;
      }
    }

    const settings = await updateSettings(body);

    // Refresh the in-memory contextWindow override map so dashboard edits apply
    // immediately (no restart). Import here — open-sse capabilities is a cold
    // path most requests never touch, and we only need it on override edits.
    if (Object.prototype.hasOwnProperty.call(body, "contextWindowOverrides")) {
      try {
        const { setContextWindowOverrides } = await import("open-sse/providers/capabilities.js");
        setContextWindowOverrides(settings.contextWindowOverrides || {});
      } catch (e) {
        console.warn("[context-overrides] refresh failed:", e?.message);
      }
    }

    // Apply outbound proxy settings immediately (no restart required)
    if (
      Object.prototype.hasOwnProperty.call(body, "outboundProxyEnabled") ||
      Object.prototype.hasOwnProperty.call(body, "outboundProxyUrl") ||
      Object.prototype.hasOwnProperty.call(body, "outboundNoProxy")
    ) {
      applyOutboundProxyEnv(settings);
    }

    // Invalidate combo rotation state when strategy settings change
    if (
      Object.prototype.hasOwnProperty.call(body, "comboStrategy") ||
      Object.prototype.hasOwnProperty.call(body, "comboStickyRoundRobinLimit") ||
      Object.prototype.hasOwnProperty.call(body, "comboStrategies")
    ) {
      resetComboRotation();
    }

    if (
      Object.prototype.hasOwnProperty.call(body, "claudeAutoPing") ||
      Object.prototype.hasOwnProperty.call(body, "codexAutoPing")
    ) {
      // Keep the scheduler absent when no account opted in; load its provider graph only on demand.
      import("@/shared/services/quotaAutoPing")
        .then(({ configureQuotaAutoPing }) => {
          configureQuotaAutoPing(settings);
        })
        .catch((error) => console.warn("[AutoPing] settings update failed:", error.message));
    }

    if (Object.prototype.hasOwnProperty.call(body, "freeModelSync")) {
      // Reconfigure the free-model discovery scheduler on toggle/interval change.
      import("@/shared/services/freeModelSync")
        .then(({ configureFreeModelSync }) => {
          configureFreeModelSync(settings);
        })
        .catch((error) => console.warn("[FreeModelSync] settings update failed:", error.message));
    }

    return NextResponse.json(toSafeSettings(settings), { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error updating settings:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
