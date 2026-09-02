"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button } from "@/shared/components";
import { getProviderCustomModelRows, parseModelIdList } from "@/shared/utils/providerCustomModels";
function CompatibleModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, isTesting, isDisabled, onToggleDisabled }) {
  const borderColor = testStatus === "ok"
    ? "border-success-line"
    : testStatus === "error"
    ? "border-danger-line"
    : "border-border";

  // Same status, same source of truth as the border above. A literal green
  // does not follow the theme, so the icon stayed a light-mode green on a dark
  // surface while the border beside it changed.
  const iconColor = testStatus === "ok"
    ? "var(--color-success)"
    : testStatus === "error"
    ? "var(--color-danger)"
    : undefined;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${borderColor} hover:bg-surface-2 ${isDisabled ? "opacity-50" : ""}`}>
      <span aria-hidden="true"
        className="material-symbols-outlined text-sm text-text-muted"
        style={iconColor ? { color: iconColor } : undefined}
      >
        {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" title={modelId}>{modelId}</p>
        <div className="flex items-center gap-1 mt-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-1 rounded">{fullModel}</code>
          <div className="relative group/btn">
            <Button
              variant="bare" size="icon-sm"
              onClick={() => onCopy(fullModel, `model-${modelId}`)}
              title={copied === `model-${modelId}` ? "Copied" : "Copy model id"}
              aria-label={copied === `model-${modelId}` ? "Copied" : "Copy model id"}
              className="hover:bg-sidebar text-text-muted hover:text-brand"
            >
              <span className="material-symbols-outlined text-sm" aria-hidden="true">
                {copied === `model-${modelId}` ? "check" : "content_copy"}
              </span>
            </Button>
            {/* `left-1/2 -translate-x-1/2` is the centering idiom, not a direction:
               the two halves cancel, so the tooltip sits under the middle of
               its trigger in RTL exactly as it does in LTR. */}
            <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-xs text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150">
              {copied === `model-${modelId}` ? "Copied!" : "Copy"}
            </span>
          </div>
          {onToggleDisabled && (
            <div className="relative group/btn">
              <Button
                variant="bare" size="icon-sm"
                onClick={onToggleDisabled}
                title={isDisabled ? "Enable model" : "Disable model"}
                aria-label={isDisabled ? "Enable model" : "Disable model"}
                className="hover:bg-sidebar text-text-muted hover:text-brand"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden="true">
                  {isDisabled ? "visibility_off" : "visibility"}
                </span>
              </Button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-xs text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150">
                {isDisabled ? "Enable" : "Disable"}
              </span>
            </div>
          )}
          {onTest && (
            <div className="relative group/btn">
              <Button
                variant="bare" size="icon-sm"
                onClick={onTest}
                disabled={isTesting}
                title={isTesting ? "Testing model" : "Test model"}
                aria-label={isTesting ? "Testing model" : "Test model"}
                className="hover:bg-sidebar text-text-muted hover:text-brand"
              >
                <span className="material-symbols-outlined text-sm" aria-hidden="true" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                  {isTesting ? "progress_activity" : "science"}
                </span>
              </Button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-xs text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150">
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
        </div>
      </div>
      <Button
        variant="bare" size="icon-sm"
        onClick={onDeleteAlias}
        className="hover:bg-danger-soft text-danger"
        title="Remove model"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-sm">delete</span>
      </Button>
    </div>
  );
}

export default function CompatibleModelsSection({ providerStorageAlias, providerDisplayAlias, modelAliases, customModels, copied, onCopy, onDeleteAlias, onAddCustomModel, onDeleteCustomModel, connections, isAnthropic, disabledModelIds, onDisableModel, onEnableModel }) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testingModelId, setTestingModelId] = useState(null);
  const [modelTestResults, setModelTestResults] = useState({});
  const [testingAll, setTestingAll] = useState(false);
  const [testAllError, setTestAllError] = useState("");
  const [catalogError, setCatalogError] = useState(null);

  const handleTestModel = async (modelId) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
    } finally {
      setTestingModelId(null);
    }
  };

  const allModels = getProviderCustomModelRows({
    customModels,
    modelAliases,
    providerAlias: providerStorageAlias,
    type: "llm",
  });

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    // Accepts a pasted list, the way the API key field already does, and skips
    // ids this provider already carries rather than refusing the whole paste.
    const ids = parseModelIdList(newModel).filter(
      (id) => !allModels.some((model) => model.id === id),
    );
    if (ids.length === 0) {
      alert("Model already exists for this provider.");
      return;
    }

    setAdding(true);
    try {
      for (const id of ids) await onAddCustomModel(id);
      setNewModel("");
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  const handleImport = async () => {
    if (importing) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) return;

    setImporting(true);
    setCatalogError(null);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCatalogError({
          message: data.catalog?.message || data.error || "Failed to import models.",
          action: data.catalog?.action || "Check the connection settings, then retry the import.",
          retryable: data.catalog?.retryable === true,
        });
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        setCatalogError({
          message: "The provider returned an empty model catalog.",
          action: "Check the provider endpoint or add models manually.",
          retryable: true,
        });
        return;
      }
      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name || model.model;
        if (!modelId) continue;
        if (allModels.some((entry) => entry.id === modelId)) continue;
        await onAddCustomModel(modelId);
        importedCount += 1;
      }
      if (importedCount === 0) {
        alert("No new models were added.");
      }
    } catch {
      setCatalogError({
        message: "Could not reach the model catalog.",
        action: "Check that tokenproxy is reachable, then retry the import.",
        retryable: true,
      });
    } finally {
      setImporting(false);
    }
  };

  // #1109: test every model on the connection in one action. The bulk endpoint
  // warms the first model serially so concurrent pings cannot each fire their own
  // refresh of the same token, which a client-side Promise.all cannot do.
  const handleTestAll = async () => {
    if (testingAll) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) return;
    setTestingAll(true);
    setTestAllError("");
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/test-models`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setTestAllError(data.error || "Test failed");
        return;
      }
      const merged = {};
      for (const r of data.results || []) merged[r.modelId] = r.ok ? "ok" : "error";
      setModelTestResults((prev) => ({ ...prev, ...merged }));
      const failed = (data.results || []).filter((r) => !r.ok);
      setTestAllError(failed.length ? `${failed.length} of ${data.results.length} models not reachable` : "");
    } catch {
      setTestAllError("Network error");
    } finally {
      setTestingAll(false);
    }
  };

  // A compatible provider's models had no enable/disable control at all, so the
  // only way to keep one out of /v1/models was to delete it. The store and the
  // listing filter both already existed and were used by the built-in provider
  // page; this section simply never received them (#3135).
  const disabledSet = new Set(disabledModelIds || []);

  const canImport = connections.some((conn) => conn.isActive !== false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Add {isAnthropic ? "Anthropic" : "OpenAI"}-compatible models manually or import them from the /models endpoint.
      </p>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label htmlFor="new-compatible-model-input" className="text-xs text-text-muted mb-1 block">Model ID</label>
          <textarea
            id="new-compatible-model-input"
            rows={1}
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              handleAdd();
            }}
            placeholder={isAnthropic ? "claude-3-opus-20240229" : "gpt-4o"}
            className="focus-ring w-full px-3 py-2 text-sm border border-border rounded-lg bg-bg focus:border-brand resize-y"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
        <Button size="sm" variant="secondary" icon="download" onClick={handleImport} disabled={!canImport || importing}>
          {importing ? "Importing..." : "Import from /models"}
        </Button>
        <Button size="sm" variant="secondary" icon="science" onClick={handleTestAll} disabled={!canImport || testingAll}>
          {testingAll ? "Testing..." : "Test All Models"}
        </Button>
      </div>

      {testAllError && <p className="text-xs text-danger break-words">{testAllError}</p>}

      {catalogError && (
        <div role="alert" className="flex items-start justify-between gap-3 px-3 py-2 rounded-lg bg-warning-soft border border-warning-line">
          <div className="min-w-0">
            <p className="text-xs font-medium text-warning break-words">{catalogError.message}</p>
            <p className="mt-1 text-xs text-text-muted break-words">{catalogError.action}</p>
          </div>
          {catalogError.retryable && (
            <Button size="sm" variant="secondary" onClick={handleImport} disabled={importing}>
              Retry import
            </Button>
          )}
        </div>
      )}

      {!canImport && (
        <p className="text-xs text-text-muted">
          Add a connection to enable importing models.
        </p>
      )}

      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels.map(({ id, alias, source }) => (
            <CompatibleModelRow
              key={`${source}-${providerStorageAlias}/${id}`}
              modelId={id}
              fullModel={`${providerDisplayAlias}/${id}`}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => source === "custom" ? onDeleteCustomModel(id) : onDeleteAlias(alias)}
              onTest={connections.length > 0 ? () => handleTestModel(id) : undefined}
              testStatus={modelTestResults[id]}
              isTesting={testingModelId === id}
              isDisabled={disabledSet.has(id)}
              onToggleDisabled={
                onDisableModel && onEnableModel
                  ? () => (disabledSet.has(id) ? onEnableModel(id) : onDisableModel(id))
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

CompatibleModelsSection.propTypes = {
  providerStorageAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  customModels: PropTypes.arrayOf(PropTypes.object),
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onAddCustomModel: PropTypes.func.isRequired,
  onDeleteCustomModel: PropTypes.func.isRequired,
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    isActive: PropTypes.bool,
  })).isRequired,
  isAnthropic: PropTypes.bool,
  disabledModelIds: PropTypes.arrayOf(PropTypes.string),
  onDisableModel: PropTypes.func,
  onEnableModel: PropTypes.func,
};
