"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Badge, Button, ModelSelectModal, ManualConfigModal, Tooltip } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";

const CLOUD_URL = process.env.NEXT_PUBLIC_CLOUD_URL;

// Context window presets. UI shows the round number; the value written is nudged
// down 2K to stay safely under the upstream hard cap.
const CONTEXT_OPTIONS = [
  { label: "Default", value: "" },
  { label: "200K", value: "198000" },
  { label: "300K", value: "298000" },
  { label: "500K", value: "498000" },
  { label: "1M", value: "998000" },
];

export default function ClaudeToolCard({
  tool,
  isExpanded,
  onToggle,
  activeProviders,
  modelMappings,
  onModelMappingChange,
  baseUrl,
  hasActiveProviders,
  apiKeys,
  cloudEnabled,
  initialStatus,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
}) {
  const [claudeStatus, setClaudeStatus] = useState(initialStatus || null);
  const [checkingClaude, setCheckingClaude] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [currentEditingAlias, setCurrentEditingAlias] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [ccFilterNaming, setCcFilterNaming] = useState(false);
  const [exaMcpEnabled, setExaMcpEnabled] = useState(false);
  const [maxContextTokens, setMaxContextTokens] = useState("");
  const hasInitializedModels = useRef(false);

  const getConfigStatus = () => {
    if (!claudeStatus?.installed) return null;
    const currentUrl = claudeStatus.settings?.env?.ANTHROPIC_BASE_URL;
    if (!currentUrl) return "not_configured";
    if (matchKnownEndpoint(currentUrl, { tunnelPublicUrl, tailscaleUrl, cloudUrl: cloudEnabled ? CLOUD_URL : null })) return "configured";
    return "other";
  };

  const configStatus = getConfigStatus();

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) {
      setClaudeStatus(initialStatus);
      setExaMcpEnabled(!!initialStatus.exaMcpEnabled);
    }
  }, [initialStatus]);

  useEffect(() => {
    const v = claudeStatus?.settings?.env?.CLAUDE_CODE_MAX_CONTEXT_TOKENS;
    setMaxContextTokens(v || "");
  }, [claudeStatus?.settings?.env?.CLAUDE_CODE_MAX_CONTEXT_TOKENS]);

  useEffect(() => {
    if (isExpanded) {
      if (!claudeStatus) checkClaudeStatus();
      fetchModelAliases();
    }
  }, [isExpanded]);

  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(data => {
      setCcFilterNaming(!!data.ccFilterNaming);
    }).catch(() => {});
  }, []);

  const handleCcFilterNamingToggle = async (e) => {
    const value = e.target.checked;
    setCcFilterNaming(value);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ccFilterNaming: value }),
    }).catch(() => {});
  };

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  };

  useEffect(() => {
    // Seed the model mappings whether or not the CLI was detected. Manual
    // configuration is the primary workflow on a remote deployment, and gating
    // this on `installed` left modelMappings empty there — so the generated
    // config carried only ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN and the
    // model pickers never appeared, even though getManualConfigs() already
    // emits an env var per mapped model (#1224). With no local settings file
    // there is nothing to read values FROM, so the defaults are used.
    if (claudeStatus && !hasInitializedModels.current) {
      hasInitializedModels.current = true;
      const env = claudeStatus.settings?.env || {};

      tool.defaultModels.forEach((model) => {
        if (model.envKey) {
          const value = env[model.envKey] || model.defaultValue || "";
          // Only sync initial values from file once
          if (value) {
            onModelMappingChange(model.alias, value);
          }
        }
      });
      // Only set selectedApiKey if it exists in apiKeys list
      const tokenFromFile = env.ANTHROPIC_AUTH_TOKEN;
      if (tokenFromFile && apiKeys?.some(k => k.key === tokenFromFile)) {
        setSelectedApiKey(tokenFromFile);
      }
    }
  }, [claudeStatus, apiKeys, tool.defaultModels, onModelMappingChange]);

  const checkClaudeStatus = async () => {
    setCheckingClaude(true);
    try {
      const res = await fetch("/api/cli-tools/claude-settings");
      const data = await res.json();
      setClaudeStatus(data);
      setExaMcpEnabled(!!data.exaMcpEnabled);
    } catch (error) {
      setClaudeStatus({ installed: false, error: error.message });
    } finally {
      setCheckingClaude(false);
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

  const handleApplySettings = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const env = { ANTHROPIC_BASE_URL: getEffectiveBaseUrl() };

      // Get key from dropdown, fallback to first key or sk_tokenproxy for localhost
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? "sk_tokenproxy" : null);

      if (keyToUse) {
        env.ANTHROPIC_AUTH_TOKEN = keyToUse;
      }

      tool.defaultModels.forEach((model) => {
        const targetModel = modelMappings[model.alias];
        if (targetModel && model.envKey) env[model.envKey] = targetModel;
      });
      if (maxContextTokens) {
        env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = maxContextTokens;
      }
      const res = await fetch("/api/cli-tools/claude-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env, exaMcpEnabled, maxContextTokens }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        setClaudeStatus(prev => ({ ...prev, hasBackup: true, settings: { ...prev?.settings, env }, exaMcpEnabled }));
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
      const res = await fetch("/api/cli-tools/claude-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        tool.defaultModels.forEach((model) => onModelMappingChange(model.alias, model.defaultValue || ""));
        setSelectedApiKey("");
        setExaMcpEnabled(false);
        setMaxContextTokens("");
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const openModelSelector = (alias) => {
    setCurrentEditingAlias(alias);
    setModalOpen(true);
  };

  const handleModelSelect = (model) => {
    if (currentEditingAlias) onModelMappingChange(currentEditingAlias, model.value);
  };

  // Generate settings.json content for manual copy
  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_tokenproxy" : "<API_KEY_FROM_DASHBOARD>");
    const env = { ANTHROPIC_BASE_URL: getEffectiveBaseUrl(), ANTHROPIC_AUTH_TOKEN: keyToUse };
    tool.defaultModels.forEach((model) => {
      const targetModel = modelMappings[model.alias];
      if (targetModel && model.envKey) env[model.envKey] = targetModel;
    });
    if (maxContextTokens) {
      env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = maxContextTokens;
    }

    return [
      {
        filename: "~/.claude/settings.json",
        content: JSON.stringify({ hasCompletedOnboarding: true, env }, null, 2),
      },
    ];
  };

  return (
    <Card padding="sm" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/claude.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} loading="lazy" decoding="async" />
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
          {checkingClaude && (
            <div className="flex items-center gap-2 text-text-muted">
              <span aria-hidden="true" className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Claude CLI...</span>
            </div>
          )}

          {!checkingClaude && claudeStatus && !claudeStatus.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-warning-soft border border-warning-line rounded-lg">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="material-symbols-outlined text-warning text-[20px]">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-warning">Claude CLI not detected locally</p>
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

              {/* Model mappings, also without a local CLI. getManualConfigs()
                  already emits an env var per mapped model, so hiding the
                  pickers here was the only thing stopping a remote deployment
                  from configuring them (#1224). */}
              <div className="flex flex-col gap-2">
                {tool.defaultModels.map((model) => (
                  <div key={model.alias} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-end sm:text-sm">{model.name}</span>
                    <span aria-hidden="true" className="material-symbols-outlined dir-icon hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <div className="relative w-full min-w-0">
                      <input
                        type="text"
                        value={modelMappings[model.alias] || ""}
                        onChange={(e) => onModelMappingChange(model.alias, e.target.value)}
                        placeholder="provider/model-id"
                        className="w-full min-w-0 ps-2 pe-8 py-2 bg-surface rounded border border-border text-xs focus-ring sm:py-1.5"
                      />
                      {modelMappings[model.alias] && (
                        <Button variant="bare" size="icon-sm" onClick={() => onModelMappingChange(model.alias, "")} aria-label="Clear" className="absolute end-1 top-1/2 -translate-y-1/2 text-text-muted hover:text-danger" title="Clear">
                          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">close</span>
                        </Button>
                      )}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openModelSelector(model.alias)}
                      disabled={!hasActiveProviders}
                      className="w-full sm:w-auto"
                    >
                      Select Model
                    </Button>
                  </div>
                ))}
              </div>
              {showInstallGuide && (
                <div className="p-4 bg-surface border border-border rounded-lg">
                  <h4 className="font-medium mb-3">Installation Guide</h4>
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-text-muted mb-1">macOS / Linux / Windows:</p>
                      <code className="block px-3 py-2 bg-surface-2 rounded font-mono text-xs">npm install -g @anthropic-ai/claude-code</code>
                    </div>
                    <p className="text-text-muted">After installation, run <code className="px-1 bg-surface-2 rounded">claude</code> to verify.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!checkingClaude && claudeStatus?.installed && (
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
                {claudeStatus?.settings?.env?.ANTHROPIC_BASE_URL && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-end sm:text-sm">Current</span>
                    <span aria-hidden="true" className="material-symbols-outlined dir-icon hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 break-all rounded bg-surface-2 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {claudeStatus.settings.env.ANTHROPIC_BASE_URL}
                    </span>
                  </div>
                )}

                {/* API Key */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-end sm:text-sm">API Key</span>
                  <span aria-hidden="true" className="material-symbols-outlined dir-icon hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                {/* Model Mappings */}
                {tool.defaultModels.map((model) => (
                  <div key={model.alias} className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-end sm:text-sm">{model.name}</span>
                    <span aria-hidden="true" className="material-symbols-outlined dir-icon hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <div className="relative w-full min-w-0">
                      <input type="text" value={modelMappings[model.alias] || ""} onChange={(e) => onModelMappingChange(model.alias, e.target.value)} placeholder="provider/model-id" className="w-full min-w-0 ps-2 pe-8 py-2 bg-surface rounded border border-border text-xs focus-ring sm:py-1.5" />
                      {modelMappings[model.alias] && <Button variant="bare" size="icon-sm" onClick={() => onModelMappingChange(model.alias, "")} aria-label="Clear" className="absolute end-1 top-1/2 -translate-y-1/2 text-text-muted hover:text-danger" title="Clear"><span aria-hidden="true" className="material-symbols-outlined text-[14px]">close</span></Button>}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openModelSelector(model.alias)}
                      disabled={!hasActiveProviders}
                      className="w-full sm:w-auto"
                    >
                      Select Model
                    </Button>
                  </div>
                ))}

                {/* Context Window */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-end sm:text-sm">Context window</span>
                  <span aria-hidden="true" className="material-symbols-outlined dir-icon hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <select value={maxContextTokens} onChange={(e) => setMaxContextTokens(e.target.value)} className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus-ring sm:py-1.5">
                    {CONTEXT_OPTIONS.map((opt) => (
                      <option key={opt.label} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* CC Filter Naming */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-end sm:text-sm">Filter naming</span>
                  <span aria-hidden="true" className="material-symbols-outlined dir-icon hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="checkbox" checked={ccFilterNaming} onChange={handleCcFilterNamingToggle} className="w-3.5 h-3.5 accent-primary cursor-pointer focus-ring" />
                    <span className="text-xs text-text-muted">Filter naming requests</span>
                    <Tooltip text="Intercepts Claude Code's topic-naming requests and returns a fake response locally, saving API tokens.">
                      <span aria-hidden="true" className="material-symbols-outlined text-text-muted text-[14px] cursor-help">info</span>
                    </Tooltip>
                  </label>
                </div>

                {/* Exa MCP — ~/.claude.json mcpServers (not settings.json) */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-end sm:text-sm">Web Search</span>
                  <span aria-hidden="true" className="material-symbols-outlined dir-icon hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="checkbox" checked={exaMcpEnabled} onChange={(e) => setExaMcpEnabled(e.target.checked)} className="w-3.5 h-3.5 accent-primary cursor-pointer focus-ring" />
                    <span className="text-xs text-text-muted">Exa MCP</span>
                    <Tooltip text="Injects Exa MCP into ~/.claude.json so non-Claude models gain web search. Restart Claude Code after Apply.">
                      <span aria-hidden="true" className="material-symbols-outlined text-text-muted text-[14px] cursor-help">info</span>
                    </Tooltip>
                  </label>
                </div>
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-success-soft text-success border border-success-line" : "bg-danger-soft text-danger border border-danger-line"}`}>
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" icon="save" onClick={handleApplySettings} disabled={!hasActiveProviders} loading={applying}>Apply</Button>
                <Button variant="secondary" size="sm" icon="restore" onClick={handleResetSettings} disabled={!claudeStatus?.hasTokenProxy} loading={restoring}>Reset</Button>
                <Button variant="ghost" size="sm" icon="content_copy" onClick={() => setShowManualConfigModal(true)}>Manual Config</Button>
              </div>
            </>
          )}
        </div>
      )}

      {modalOpen && (
        <ModelSelectModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSelect={handleModelSelect} selectedModel={currentEditingAlias ? modelMappings[currentEditingAlias] : null} activeProviders={activeProviders} modelAliases={modelAliases} title={`Select model for ${currentEditingAlias}`} />
      )}

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Claude CLI - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
