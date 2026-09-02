"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Badge, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";

const CLOUD_URL = process.env.NEXT_PUBLIC_CLOUD_URL;

export default function DroidToolCard({
  tool,
  isExpanded,
  onToggle,
  baseUrl,
  hasActiveProviders,
  apiKeys,
  activeProviders,
  cloudEnabled,
  initialStatus,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
}) {
  const [droidStatus, setDroidStatus] = useState(initialStatus || null);
  const [checkingDroid, setCheckingDroid] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [modelList, setModelList] = useState([]);
  const [modelInput, setModelInput] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const hasInitializedModel = useRef(false);

  const getConfigStatus = () => {
    if (!droidStatus?.installed) return null;
    // Check for any TokenProxy model entry (support multi-model: custom:TokenProxy-0, custom:TokenProxy-1, ...)
    const currentConfig = droidStatus.settings?.customModels?.find(m => m.id?.startsWith("custom:TokenProxy"));
    if (!currentConfig) return "not_configured";
    return matchKnownEndpoint(currentConfig.baseUrl, { tunnelPublicUrl, tailscaleUrl, cloudUrl: cloudEnabled ? CLOUD_URL : null }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setDroidStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded) {
      if (!droidStatus) checkDroidStatus();
      fetchModelAliases();
    }
  }, [isExpanded]);

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  };

  // Pre-fill model list from existing config (supports multi-model)
  useEffect(() => {
    if (droidStatus?.installed && !hasInitializedModel.current) {
      hasInitializedModel.current = true;
      const existingModels = (droidStatus.settings?.customModels || [])
        .filter(m => m.id?.startsWith("custom:TokenProxy"))
        .sort((a, b) => (a.index || 0) - (b.index || 0))
        .map(m => m.model);
      if (existingModels.length > 0) {
        setModelList(existingModels);
      } else {
        // Legacy: single model stored as custom:TokenProxy-0
        const legacy = droidStatus.settings?.customModels?.find(m => m.id === "custom:TokenProxy-0");
        if (legacy?.model) {
          setModelList([legacy.model]);
        }
      }
    }
  }, [droidStatus]);

  const checkDroidStatus = async () => {
    setCheckingDroid(true);
    try {
      const res = await fetch("/api/cli-tools/droid-settings");
      const data = await res.json();
      setDroidStatus(data);
    } catch (error) {
      setDroidStatus({ installed: false, error: error.message });
    } finally {
      setCheckingDroid(false);
    }
  };

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const addModel = () => {
    const val = modelInput.trim();
    if (!val || modelList.includes(val)) return;
    setModelList((prev) => [...prev, val]);
    setModelInput("");
  };

  const removeModel = (id) => setModelList((prev) => prev.filter((m) => m !== id));

  const handleModelSelect = (model) => {
    if (!model.value || modelList.includes(model.value)) return;
    setModelList((prev) => [...prev, model.value]);
    setModalOpen(false);
  };

  const handleApplySettings = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? "sk_tokenproxy" : null);

      const res = await fetch("/api/cli-tools/droid-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          models: modelList,
          activeModel: modelList[0] || "",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkDroidStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  const handleResetSettings = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/droid-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setModelList([]);
        checkDroidStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_tokenproxy" : "<API_KEY_FROM_DASHBOARD>");

    const settingsContent = {
      customModels: modelList.map((m, i) => ({
        model: m,
        id: `custom:TokenProxy-${i}`,
        index: i,
        baseUrl: getEffectiveBaseUrl(),
        apiKey: keyToUse,
        displayName: m,
        maxOutputTokens: 131072,
        noImageSupport: false,
        provider: "openai",
      })),
    };

    const platform = typeof navigator !== "undefined" && navigator.platform;
    const isWindows = platform?.toLowerCase().includes("win");
    const settingsPath = isWindows
      ? "%USERPROFILE%\\.factory\\settings.json"
      : "~/.factory/settings.json";

    return [
      {
        filename: settingsPath,
        content: JSON.stringify(settingsContent, null, 2),
      },
    ];
  };

  return (
    <Card padding="sm" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/droid.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} loading="lazy" decoding="async" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {configStatus === "configured" && <Badge variant="success" size="md">Connected</Badge>}
              {configStatus === "not_configured" && <Badge variant="warning" size="md">Not configured</Badge>}
              {configStatus === "other" && <Badge variant="info" size="md">Other</Badge>}
            </div>
            <p className="text-xs text-text-muted">{tool.description}</p>
          </div>
        </div>
        <span aria-hidden="true" className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
          {checkingDroid && (
            <div className="flex items-center gap-2 text-text-muted">
              <span aria-hidden="true" className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Factory Droid CLI...</span>
            </div>
          )}

          {!checkingDroid && droidStatus && !droidStatus.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-warning-soft border border-warning-line rounded-lg">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="material-symbols-outlined text-warning text-[20px]">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-warning">Factory Droid CLI not detected locally</p>
                    <p className="text-sm text-text-muted">Manual configuration is still available if tokenproxy is deployed on a remote server.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 ps-8">
                  <Button variant="secondary" size="sm" icon="content_copy" onClick={() => setShowManualConfigModal(true)}>Manual Config</Button>
                  <Button variant="secondary" size="sm" icon={showInstallGuide ? "expand_less" : "help"} onClick={() => setShowInstallGuide(!showInstallGuide)}>
                    {showInstallGuide ? "Hide" : "How to Install"}
                  </Button>
                </div>
              </div>
              {showInstallGuide && (
                <div className="p-4 bg-surface border border-border rounded-lg">
                  <h4 className="font-medium mb-3">Installation Guide</h4>
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-text-muted mb-1">macOS / Linux / Windows:</p>
                      <code className="block px-3 py-2 bg-surface-2 rounded font-mono text-xs">curl -fsSL https://app.factory.ai/cli | sh</code>
                    </div>
                    <p className="text-text-muted">After installation, run <code className="px-1 bg-surface-2 rounded">droid</code> to verify.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!checkingDroid && droidStatus?.installed && (
            <>
              <div className="flex flex-col gap-2">
                {/* Endpoint (selector) */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-end sm:text-sm">Select Endpoint</span>
                  <span aria-hidden="true" className="material-symbols-outlined dir-icon hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <BaseUrlSelect
                    value={customBaseUrl || getDisplayUrl()}
                    onChange={setCustomBaseUrl}
                    requiresExternalUrl={tool.requiresExternalUrl}
                    tunnelEnabled={tunnelEnabled}
                    tunnelPublicUrl={tunnelPublicUrl}
                    tailscaleEnabled={tailscaleEnabled}
                    tailscaleUrl={tailscaleUrl}
                  />
                </div>

                {/* Current configured */}
                {droidStatus?.settings?.customModels?.find(m => m.id?.startsWith("custom:TokenProxy"))?.baseUrl && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-end sm:text-sm">Current</span>
                    <span aria-hidden="true" className="material-symbols-outlined dir-icon hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 break-all rounded bg-surface-2 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {droidStatus.settings.customModels.find(m => m.id?.startsWith("custom:TokenProxy")).baseUrl}
                    </span>
                  </div>
                )}

                {/* API Key */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-end sm:text-sm">API Key</span>
                  <span aria-hidden="true" className="material-symbols-outlined dir-icon hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                {/* Models */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-end sm:text-sm">
                    Models {modelList.length > 0 && <span className="text-brand metric">({modelList.length})</span>}
                  </span>
                  <span aria-hidden="true" className="material-symbols-outlined dir-icon hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <div className="flex-1 flex flex-col gap-1">
                    {/* Model list */}
                    {modelList.length > 0 && (
                      <div className="flex flex-col gap-1 mb-1">
                        {modelList.map((id) => (
                          <div key={id} className="flex items-center gap-1.5 px-2 py-1 bg-surface-2 rounded border border-border">
                            <span className="flex-1 text-xs font-mono truncate">{id}</span>
                            <Button variant="bare" size="icon-sm" onClick={() => removeModel(id)} aria-label={`Remove ${id}`} className="text-text-muted hover:text-danger shrink-0" title="Remove">
                              <span aria-hidden="true" className="material-symbols-outlined text-[12px]">close</span>
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Model input row */}
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={modelInput}
                        onChange={(e) => setModelInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addModel(); } }}
                        placeholder="provider/model-id"
                        className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus-ring sm:py-1.5"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setModalOpen(true)}
                        disabled={!hasActiveProviders}
                        className="shrink-0"
                      >
                        Select
                      </Button>
                      <Button variant="secondary" size="sm" icon="add" onClick={addModel} disabled={!modelInput.trim()} title="Add model" aria-label="Add model" className="shrink-0" />
                    </div>
                  </div>
                </div>
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-success-soft text-success border border-success-line" : "bg-danger-soft text-danger border border-danger-line"}`}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" icon="save" onClick={handleApplySettings} disabled={modelList.length === 0} loading={applying}>Apply</Button>
                <Button variant="secondary" size="sm" icon="restore" onClick={handleResetSettings} disabled={!droidStatus?.hasTokenProxy} loading={restoring}>Reset</Button>
                <Button variant="ghost" size="sm" icon="content_copy" onClick={() => setShowManualConfigModal(true)}>Manual Config</Button>
              </div>
            </>
          )}
        </div>
      )}

      {modalOpen && (
        <ModelSelectModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onSelect={handleModelSelect}
          selectedModel={null}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title="Select Model for Factory Droid"
        />
      )}

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Factory Droid - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
