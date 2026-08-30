"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import Card from "./Card";
import Select from "./Select";
import Badge from "./Badge";
import {
  createProviderStrategySaveQueue,
  saveProviderStrategyPatch,
} from "../utils/providerStrategyPatch";

const NONE_PROXY_POOL_VALUE = "__none__";
const STRATEGIES = [
  { value: "none", label: "None (single pool)" },
  { value: "round-robin", label: "Round-robin" },
  { value: "random", label: "Random" },
];

export default function NoAuthProxyCard({ providerId }) {
  const [proxyPools, setProxyPools] = useState([]);
  const [proxyPoolId, setProxyPoolId] = useState(NONE_PROXY_POOL_VALUE);
  const [rotateStrategy, setRotateStrategy] = useState("none");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState("");
  const confirmedRef = useRef({
    poolId: NONE_PROXY_POOL_VALUE,
    strategy: "none",
  });
  const flashTimerRef = useRef(null);
  const providerStrategySaveQueueRef = useRef(null);
  if (providerStrategySaveQueueRef.current == null) {
    providerStrategySaveQueueRef.current = createProviderStrategySaveQueue(
      saveProviderStrategyPatch,
      setSaving,
    );
  }
  const enqueueProviderStrategySave = providerStrategySaveQueueRef.current;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }).then((r) => r.ok ? r.json() : { proxyPools: [] }),
      fetch("/api/settings", { cache: "no-store" }).then((r) => r.ok ? r.json() : {}),
    ]).then(([poolData, settingsData]) => {
      if (cancelled) return;
      setProxyPools(poolData.proxyPools || []);
      const override = (settingsData.providerStrategies || {})[providerId] || {};
      const poolId = override.proxyPoolId || NONE_PROXY_POOL_VALUE;
      const strategy = override.rotateStrategy || "none";
      setProxyPoolId(poolId);
      setRotateStrategy(strategy);
      confirmedRef.current = { poolId, strategy };
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, [providerId]);

  const save = useCallback((poolId, strategy) => {
    const values = {
      proxyPoolId: poolId === NONE_PROXY_POOL_VALUE ? null : poolId,
      rotateStrategy: strategy === "none" ? null : strategy,
    };
    setError("");
    return enqueueProviderStrategySave({
      providerId,
      values,
      onStart: () => setError(""),
      onSuccess: () => {
        confirmedRef.current = { poolId, strategy };
        setProxyPoolId(poolId);
        setRotateStrategy(strategy);
        setSavedFlash(true);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => setSavedFlash(false), 1500);
      },
      onError: (error) => {
        console.log("Save proxy config error:", error);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        setProxyPoolId(confirmedRef.current.poolId);
        setRotateStrategy(confirmedRef.current.strategy);
        setSavedFlash(false);
        setError(error.message);
      },
    }).catch(() => {});
  }, [enqueueProviderStrategySave, providerId]);

  const handlePoolChange = (newPoolId) => {
    setProxyPoolId(newPoolId);
    save(newPoolId, rotateStrategy);
  };

  const handleStrategyChange = (newStrategy) => {
    setRotateStrategy(newStrategy);
    save(proxyPoolId, newStrategy);
  };

  const canRotate = proxyPools.length >= 2;
  const isRotation = rotateStrategy !== "none";

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-success-soft text-success">
          <span className="material-symbols-outlined text-[20px]">lock_open</span>
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">No authentication required</p>
          <p className="text-xs text-text-muted">This provider is ready to use. Optionally route requests through a proxy pool to bypass IP-based limits.</p>
        </div>
        {savedFlash && <Badge variant="success" size="sm">Saved</Badge>}
      </div>

      <Select
        label="Proxy Pool"
        value={proxyPoolId}
        onChange={(e) => handlePoolChange(e.target.value)}
        disabled={saving || isRotation}
        options={[
          { value: NONE_PROXY_POOL_VALUE, label: "None (direct)" },
          ...proxyPools.map((pool) => ({ value: pool.id, label: pool.name })),
        ]}
        hint={isRotation ? "Pool selector is ignored when rotation is active — all active pools are used." : undefined}
      />

      <div className="flex flex-col gap-2 mt-4">
        <label className="text-sm font-medium text-text-main">Rotation Strategy</label>
        <select
          value={rotateStrategy}
          onChange={(e) => handleStrategyChange(e.target.value)}
          disabled={saving}
          className="focus-ring py-2 px-3 text-sm text-text-main bg-surface border border-border rounded-md focus:border-primary/50 transition-all disabled:opacity-50"
        >
          {STRATEGIES.map((s) => (
            <option key={s.value} value={s.value} disabled={s.value !== "none" && !canRotate}>
              {s.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-text-muted">
          {!canRotate
            ? `Need at least 2 active proxy pools for rotation.`
            : isRotation
              ? rotateStrategy === "round-robin"
                ? `Rotating through all ${proxyPools.length} active pools in order. State is in-memory (resets on restart).`
                : `Picking a random pool from ${proxyPools.length} active pools each request.`
              : `Uses the selected pool above. Set to Round-robin or Random to rotate across all active pools.`}
        </p>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </Card>
  );
}

NoAuthProxyCard.propTypes = {
  providerId: PropTypes.string.isRequired,
};
