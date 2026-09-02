"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";

export default function AddCustomModelModal({ isOpen, providerAlias, providerDisplayAlias, onSave, onClose }) {
  const [modelId, setModelId] = useState("");
  const [testStatus, setTestStatus] = useState(null); // null | "testing" | "ok" | "error"
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);
  // A model id the capabilities tables do not recognise falls to the text-only
  // default, so an image-capable model added by hand silently dropped every
  // image with no way to say otherwise (#1904).
  const [vision, setVision] = useState(false);
  // Context and output ceilings for a model the capability tables do not know.
  // The store has carried these per custom model since before they were read;
  // #1904 gave them a reader, and this gives them a way in (#1294).
  const [maxInputTokens, setMaxInputTokens] = useState("");
  const [maxOutputTokens, setMaxOutputTokens] = useState("");

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) { setModelId(""); setTestStatus(null); setTestError(""); setVision(false); setMaxInputTokens(""); setMaxOutputTokens(""); }
  }, [isOpen]);

  // Strip provider's own alias prefix (e.g. "cc/model" -> "model" for cc provider)
  const stripAlias = (id) => {
    const prefix = `${providerAlias}/`;
    return id.startsWith(prefix) ? id.slice(prefix.length) : id;
  };

  const handleTest = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId) return;
    setTestStatus("testing");
    setTestError("");
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${cleanId}` }),
      });
      const data = await res.json();
      setTestStatus(data.ok ? "ok" : "error");
      setTestError(data.error || "");
    } catch (err) {
      setTestStatus("error");
      setTestError(err.message);
    }
  };

  const handleSave = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId || saving) return;
    setSaving(true);
    try {
      await onSave(cleanId, {
        vision,
        maxInputTokens: toPositiveInt(maxInputTokens),
        maxOutputTokens: toPositiveInt(maxOutputTokens),
      });
    } finally {
      setSaving(false);
    }
  };

  // Blank means "no override", which is not the same as zero: the API rejects a
  // non-positive value, so an empty field must send nothing at all.
  const toPositiveInt = (raw) => {
    const n = Number.parseInt(String(raw).trim(), 10);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleTest();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Custom Model">
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="add-custom-model-id" className="text-sm font-medium mb-1.5 block">Model ID</label>
          <div className="flex gap-2">
            <input
              id="add-custom-model-id"
              type="text"
              value={modelId}
              onChange={(e) => { setModelId(e.target.value); setTestStatus(null); setTestError(""); }}
              onKeyDown={handleKeyDown}
              placeholder="e.g. claude-opus-4-5"
              className="focus-ring flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-bg focus:border-brand"
              autoFocus
            />
            <Button
              variant="secondary"
              icon="science"
              loading={testStatus === "testing"}
              onClick={handleTest}
              disabled={!modelId.trim() || testStatus === "testing"}
            >
              {testStatus === "testing" ? "Testing..." : "Test"}
            </Button>
          </div>
          <p className="text-xs text-text-muted mt-1">
            Sent to provider as: <code className="font-mono bg-sidebar px-1 rounded">{stripAlias(modelId.trim()) || "model-id"}</code>
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="custom-model-max-input" className="text-xs text-text-muted mb-1 block">
              Context window (optional)
            </label>
            <input
              id="custom-model-max-input"
              type="number"
              min="1"
              value={maxInputTokens}
              onChange={(e) => setMaxInputTokens(e.target.value)}
              placeholder="e.g. 200000"
              className="focus-ring w-full px-3 py-2 text-sm border border-border rounded-lg bg-bg focus:border-brand"
            />
          </div>
          <div>
            <label htmlFor="custom-model-max-output" className="text-xs text-text-muted mb-1 block">
              Max output tokens (optional)
            </label>
            <input
              id="custom-model-max-output"
              type="number"
              min="1"
              value={maxOutputTokens}
              onChange={(e) => setMaxOutputTokens(e.target.value)}
              placeholder="e.g. 64000"
              className="focus-ring w-full px-3 py-2 text-sm border border-border rounded-lg bg-bg focus:border-brand"
            />
          </div>
        </div>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={vision}
            onChange={(e) => setVision(e.target.checked)}
            className="focus-ring mt-1 size-4 accent-brand"
          />
          <span className="text-sm">
            This model accepts images
            <span className="block text-xs text-text-muted">
              Tick this when the model has vision but TokenProxy does not recognise its id. Images
              are dropped from the request otherwise.
            </span>
          </span>
        </label>

        {/* Test result */}
        {testStatus === "ok" && (
          <div className="flex items-center gap-2 text-sm text-success">
            <span aria-hidden="true" className="material-symbols-outlined text-sm">check_circle</span>
            Model is reachable
          </div>
        )}
        {testStatus === "error" && (
          <div className="flex items-start gap-2 text-sm text-danger">
            <span aria-hidden="true" className="material-symbols-outlined text-sm shrink-0">cancel</span>
            <span>{testError || "Model not reachable"}</span>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button onClick={onClose} variant="ghost" fullWidth size="sm">Cancel</Button>
          <Button
            onClick={handleSave}
            fullWidth
            size="sm"
            disabled={!modelId.trim() || saving}
          >
            {saving ? "Adding..." : "Add Model"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddCustomModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
