"use client";

import { useState } from "react";
import { Card, Button, ModelSelectModal } from "@/shared/components";
import { getProviderIconSrc, markProviderIconMissing } from "@/shared/utils/providerIcon";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import Image from "next/image";
import ApiKeySelect from "./ApiKeySelect";

export function replaceGuideVariables(text, {
  baseUrl,
  apiKey,
  cloudEnabled = false,
  model,
} = {}) {
  const keyToUse = (apiKey && apiKey.trim())
    ? apiKey
    : (!cloudEnabled ? "sk_9router" : "your-api-key");
  const configuredBaseUrl = baseUrl || "http://localhost:20128";
  const normalizedBaseUrl = configuredBaseUrl.replace(/\/+$/, "");
  const baseUrlWithV1 = normalizedBaseUrl.endsWith("/v1")
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/v1`;

  return text
    .replace(/\{\{baseUrl\}\}/g, baseUrlWithV1)
    .replace(/\{\{apiKey\}\}/g, keyToUse)
    .replace(/\{\{model\}\}/g, model || "provider/model-id");
}

export default function DefaultToolCard({ toolId, tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders = [], cloudEnabled = false, tunnelEnabled = false }) {
  const [copiedField, setCopiedField] = useState(null);
  const [showModelModal, setShowModelModal] = useState(false);
  const [modelValue, setModelValue] = useState("");
  
  // Initialize state directly with computed value - no need for useEffect
  const [selectedApiKey, setSelectedApiKey] = useState(() => 
    apiKeys?.length > 0 ? apiKeys[0].key : ""
  );

  const replaceVars = (text) => replaceGuideVariables(text, {
    baseUrl,
    apiKey: selectedApiKey,
    cloudEnabled,
    model: modelValue,
  });

  const { copy: copyToClipboard } = useCopyToClipboard();

  const handleCopy = async (text, field) => {
    await copyToClipboard(replaceVars(text), `toolcard-${field}`);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSelectModel = (model) => {
    setModelValue(model.value);
  };

  const hasActiveProviders = activeProviders.length > 0;

  const renderApiKeySelector = () => (
    <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
      <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} className="flex-1" />
    </div>
  );

  const renderModelSelector = () => {
    return (
      <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
        <input
          type="text"
          value={modelValue}
          onChange={(e) => setModelValue(e.target.value)}
          placeholder="provider/model-id"
          className="w-full sm:w-auto flex-1 px-3 py-2 bg-surface-2 rounded-lg text-xs border border-border focus-ring"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowModelModal(true)}
          disabled={!hasActiveProviders}
          className="shrink-0"
        >
          Select Model
        </Button>
        {modelValue && (
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={copiedField === "model" ? "check" : "content_copy"}
              onClick={() => handleCopy(modelValue, "model")}
              aria-label="Copy model id"
              className="shrink-0"
            />
            <Button
              variant="bare" size="icon"
              onClick={() => setModelValue("")}
              aria-label="Clear" className="text-text-muted hover:text-danger"
              title="Clear"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </Button>
          </>
        )}
      </div>
    );
  };

  const renderNotes = () => {
    if (!tool.notes || tool.notes.length === 0) return null;
    
    return (
      <div className="flex flex-col gap-2 mb-4">
        {tool.notes.map((note, index) => {
          // Skip cloudCheck note if tunnel or cloud is enabled
          if (note.type === "cloudCheck" && (cloudEnabled || tunnelEnabled)) return null;
          
          const isWarning = note.type === "warning";
          const isError = note.type === "error" || (note.type === "cloudCheck" && !cloudEnabled && !tunnelEnabled);
          
          let bgClass = "bg-info-soft border-info-line";
          let textClass = "text-info";
          let iconClass = "text-info";
          let icon = "info";
          
          if (isWarning) {
            bgClass = "bg-warning-soft border-warning-line";
            textClass = "text-warning";
            iconClass = "text-warning";
            icon = "warning";
          } else if (isError) {
            bgClass = "bg-danger-soft border-danger-line";
            textClass = "text-danger";
            iconClass = "text-danger";
            icon = "error";
          }
          
          return (
            <div key={index} className={`flex items-start gap-3 p-3 rounded-lg border ${bgClass}`}>
              <span className={`material-symbols-outlined text-[20px] ${iconClass}`}>{icon}</span>
              <p className={`text-sm ${textClass}`}>{note.text}</p>
            </div>
          );
        })}
      </div>
    );
  };

  const canShowGuide = () => {
    if (tool.requiresExternalUrl && !cloudEnabled && !tunnelEnabled) return false;
    if (tool.requiresCloud && !cloudEnabled) return false;
    return true;
  };

  const renderGuideSteps = () => {
    if (!tool.guideSteps) return renderNotes() || <p className="text-text-muted text-sm">Coming soon...</p>;

    return (
      <div className="flex flex-col gap-4">
        {renderNotes()}
        {canShowGuide() && tool.guideSteps.map((item) => (
          <div key={item.step} className="flex items-start gap-4">
            <div 
              className="size-8 rounded-full flex items-center justify-center shrink-0 bg-surface-3 text-sm font-semibold text-text-main metric"
            >
              {item.step}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-main">{item.title}</p>
              {item.desc && <p className="text-sm text-text-muted mt-0.5">{item.desc}</p>}
              {item.type === "apiKeySelector" && renderApiKeySelector()}
              {item.type === "modelSelector" && renderModelSelector()}
              {item.value && (
                <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
                  <code className="w-full sm:w-auto min-w-0 flex-1 px-3 py-2 bg-surface-2 rounded-lg text-sm font-mono border border-border break-all">
                    {replaceVars(item.value)}
                  </code>
                  {item.copyable && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={copiedField === `${item.step}-${item.title}` ? "check" : "content_copy"}
                      onClick={() => handleCopy(item.value, `${item.step}-${item.title}`)}
                      aria-label="Copy value"
                      className="shrink-0"
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {canShowGuide() && tool.codeBlock && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-muted uppercase tracking-wide">{tool.codeBlock.language}</span>
              <Button
                variant="secondary"
                size="sm"
                icon={copiedField === "codeblock" ? "check" : "content_copy"}
                onClick={() => handleCopy(tool.codeBlock.code, "codeblock")}
              >
                {copiedField === "codeblock" ? "Copied!" : "Copy"}
              </Button>
            </div>
            <pre className="p-4 bg-surface-2 rounded-lg border border-border overflow-x-auto">
              <code className="text-sm font-mono whitespace-pre">{replaceVars(tool.codeBlock.code)}</code>
            </pre>
          </div>
        )}
      </div>
    );
  };

  const renderIcon = () => {
    if (tool.image) {
      return (
        <Image
          src={tool.image}
          alt={tool.name}
          width={32}
          height={32}
          className="size-8 object-contain rounded-lg"
          sizes="32px"
          onError={(e) => { e.target.style.display = "none"; }}
        loading="lazy"
        decoding="async"
        />
      );
    }
    if (tool.icon) {
      return <span className="material-symbols-outlined text-xl" style={{ color: tool.color }}>{tool.icon}</span>;
    }
    const iconSrc = getProviderIconSrc(toolId);
    if (!iconSrc) {
      return <span className="text-xs font-bold" style={{ color: tool.color }}>{(toolId || "?").slice(0, 2).toUpperCase()}</span>;
    }
    return (
      <Image
        src={iconSrc}
        alt={tool.name}
        width={32}
        height={32}
        className="size-8 object-contain rounded-lg"
        sizes="32px"
        onError={(e) => {
          markProviderIconMissing(toolId);
          e.target.style.display = "none";
        }}
      loading="lazy"
      decoding="async"
      />
    );
  };

  return (
    <Card padding="sm" className="overflow-hidden overflow-x-hidden">
      <div className="flex items-center justify-between hover:cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-lg flex items-center justify-center shrink-0">
            {renderIcon()}
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-sm">{tool.name}</h3>
            <p className="text-xs text-text-muted">{tool.description}</p>
          </div>
        </div>
        <span className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </div>

      {isExpanded && (
        <div className="mt-6 pt-6 border-t border-border">
          {renderGuideSteps()}
        </div>
      )}

      {showModelModal && (
        <ModelSelectModal
          isOpen={showModelModal}
          onClose={() => setShowModelModal(false)}
          onSelect={handleSelectModel}
          selectedModel={modelValue}
          activeProviders={activeProviders}
          title="Select Model"
        />
      )}
    </Card>
  );
}
