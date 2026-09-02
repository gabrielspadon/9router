"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, Badge, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";

// Pi keeps every provider in ~/.pi/agent/models.json under `providers.tokenproxy`.
// Its schema has no active-model or subagent concept, so this is the OpenCode
// flow minus those two controls, bound to the fields pi-settings actually returns.
export default function PiToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl }) {
  const [status, setStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [selectedApiKey, setSelectedApiKey] = useState(apiKeys?.[0]?.key || "");
  const [modalOpen, setModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [selectedModels, setSelectedModels] = useState(initialStatus?.pi?.models || []);
  const selectedModelsRef = useRef([]);
  const hasFetchedStatus = useRef(Boolean(initialStatus));

  const fetchModelAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  }, []);

  // The chip list is hydrated from the response itself rather than from a
  // [status] effect, so a fetch is one render pass instead of a cascading one.
  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/cli-tools/pi-settings");
      const data = await res.json();
      setStatus(data);
      hasFetchedStatus.current = true;
      setSelectedModels(data?.pi?.models || []);
    } catch (error) {
      setStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    selectedModelsRef.current = selectedModels;
  }, [selectedModels]);

  useEffect(() => {
    if (!isExpanded) return;
    let cancelled = false;
    const synchronize = async () => {
      if (!hasFetchedStatus.current) await checkStatus();
      if (!cancelled) await fetchModelAliases();
    };
    synchronize();
    return () => { cancelled = true; };
  }, [isExpanded, checkStatus, fetchModelAliases]);

  const getKeyToUse = () => (selectedApiKey && selectedApiKey.trim())
    ? selectedApiKey
    : (!cloudEnabled ? "sk_tokenproxy" : selectedApiKey);

  const saveModels = async (models) => {
    try {
      await fetch("/api/cli-tools/pi-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: getEffectiveBaseUrl(), apiKey: getKeyToUse(), models }),
      });
    } catch (error) {
      console.log("Error saving models:", error);
    }
  };

  // The route reports the live entry as pi.baseURL and the raw file as
  // config.providers["tokenproxy"].baseUrl; either one is the configured endpoint.
  const getConfiguredBaseUrl = () => status?.config?.providers?.["tokenproxy"]?.baseUrl || status?.pi?.baseURL || "";

  const getConfigStatus = () => {
    if (!status?.installed) return null;
    if (!status.config) return "not_configured";
    if (!status.hasTokenProxy) return "not_configured";
    return matchKnownEndpoint(getConfiguredBaseUrl(), { tunnelPublicUrl, tailscaleUrl }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/pi-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: getEffectiveBaseUrl(), apiKey: getKeyToUse(), models: selectedModels }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  const handleReset = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/pi-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModels([]);
        checkStatus();
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

    const modelsToShow = selectedModels.length > 0 ? selectedModels : ["provider/model-id"];

    return [{
      filename: "~/.pi/agent/models.json",
      content: JSON.stringify({
        providers: {
          "tokenproxy": {
            baseUrl: getEffectiveBaseUrl(),
            api: "openai-completions",
            apiKey: keyToUse,
            models: modelsToShow.map((id) => ({ id, input: ["text", "image"] })),
          },
        },
      }, null, 2),
    }];
  };

  return (
    <Card padding="sm" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[28px]" style={{ color: tool.color }} aria-hidden="true">{tool.icon}</span>
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
          {checking && (
            <div className="flex items-center gap-2 text-text-muted">
              <span aria-hidden="true" className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Pi CLI...</span>
            </div>
          )}

          {!checking && status && !status.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-warning-soft border border-warning-line rounded-lg">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="material-symbols-outlined text-warning text-[20px]">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-warning">Pi CLI not detected locally</p>
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
                    <p className="text-text-muted">Install Pi from <code className="px-1 bg-surface-2 rounded">pi.dev</code>, then run <code className="px-1 bg-surface-2 rounded">pi</code> to verify.</p>
                    <p className="text-text-muted">Detection also succeeds once <code className="px-1 bg-surface-2 rounded">~/.pi/agent/models.json</code> exists, so a Pi installed outside this server&apos;s PATH still shows up.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!checking && status?.installed && (
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
                {getConfiguredBaseUrl() && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-end sm:text-sm">Current</span>
                    <span aria-hidden="true" className="material-symbols-outlined dir-icon hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 break-all rounded bg-surface-2 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {getConfiguredBaseUrl()}
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
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                  <span className="text-sm font-semibold text-text-main sm:text-end sm:pt-1">Models</span>
                  <span aria-hidden="true" className="material-symbols-outlined dir-icon text-text-muted text-[14px] mt-1.5">arrow_forward</span>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex flex-wrap gap-1.5 min-h-[28px] px-2 py-1.5 bg-surface rounded border border-border">
                      {selectedModels.length === 0 ? (
                        <span className="text-xs text-text-muted">No models selected</span>
                      ) : (
                        selectedModels.map((model) => (
                          <span
                            key={model}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-surface-2 text-text-muted border border-transparent"
                          >
                            {model}
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  const res = await fetch(`/api/cli-tools/pi-settings?model=${encodeURIComponent(model)}`, { method: "DELETE" });
                                  if (res.ok) {
                                    setSelectedModels(selectedModels.filter((m) => m !== model));
                                    checkStatus();
                                  }
                                } catch (error) {
                                  console.log("Error removing model:", error);
                                }
                              }}
                              aria-label={`Remove ${model}`} className="ms-1 hover:text-danger focus-ring"
                            >
                              <span className="material-symbols-outlined text-[12px]" aria-hidden="true">close</span>
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setModalOpen(true)} disabled={!activeProviders?.length}>Add Model</Button>
                      <span className="text-xs text-text-muted">
                        {selectedModels.length > 0 ? `${selectedModels.length} model(s) configured` : "Select models to add"}
                      </span>
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
                <Button variant="primary" size="sm" icon="save" onClick={handleApply} disabled={selectedModels.length === 0} loading={applying}>Apply</Button>
                <Button variant="secondary" size="sm" icon="restore" onClick={handleReset} disabled={!status.hasTokenProxy} loading={restoring}>Reset</Button>
                <Button variant="ghost" size="sm" icon="content_copy" onClick={() => setShowManualConfigModal(true)}>Manual Config</Button>
              </div>
            </>
          )}
        </div>
      )}

      {modalOpen && (
        <ModelSelectModal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
            saveModels(selectedModelsRef.current);
          }}
          onSelect={(model) => {
            if (!selectedModels.includes(model.value)) {
              setSelectedModels([...selectedModels, model.value]);
            }
          }}
          onDeselect={(model) => {
            setSelectedModels(selectedModels.filter(m => m !== model.value));
          }}
          selectedModel={null}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          addedModelValues={selectedModels}
          closeOnSelect={false}
          title="Add Model for Pi"
        />
      )}

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Pi - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
