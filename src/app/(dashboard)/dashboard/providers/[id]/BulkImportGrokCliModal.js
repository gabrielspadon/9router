"use client";

import { useRef, useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";
import { translate } from "@/i18n/runtime";

const PLACEHOLDER = `[
  {
    "access_token": "eyJ0eXAiOiJhdCtqd3Qi...",
    "refresh_token": "LZhriF9bf88pPykpXCuZ9...",
    "id_token": "eyJ0eXAiOiJKV1QiLCJhbGci...",
    "email": "account1@example.com"
  }
]`;

// The CLI writes one file per account, so a paste is routinely several objects
// with nothing joining them. Recovering that costs a retry, not a JSON parser.
export function parseAccountsInput(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (initialErr) {
    try {
      let fixed = trimmed.replace(/\}\s*,?\s*\{/g, "},{");
      if (fixed.endsWith(",")) fixed = fixed.slice(0, -1);
      parsed = JSON.parse(`[${fixed}]`);
    } catch {
      throw initialErr;
    }
  }

  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.accounts)) return parsed.accounts;
    return [parsed];
  }
  throw new Error("Input must be a JSON object or array of objects");
}

export default function BulkImportGrokCliModal({ isOpen, onClose, onSuccess }) {
  const [jsonText, setJsonText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [parseError, setParseError] = useState("");
  const [result, setResult] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [loaded, setLoaded] = useState(null);
  const fileInputRef = useRef(null);

  const handleClose = () => {
    if (submitting) return;
    setJsonText("");
    setParseError("");
    setResult(null);
    setLoaded(null);
    setIsDragging(false);
    onClose();
  };

  const processFiles = async (files) => {
    if (!files || files.length === 0) return;
    setParseError("");
    const jsonFiles = Array.from(files).filter(
      (f) => f.name.endsWith(".json") || f.type === "application/json" || f.type === ""
    );
    if (jsonFiles.length === 0) {
      setParseError(translate("Please select valid .json files"));
      return;
    }

    try {
      const accounts = [];
      for (const file of jsonFiles) {
        accounts.push(...parseAccountsInput(await file.text()));
      }
      if (accounts.length === 0) {
        setParseError(translate("No accounts found in selected files"));
        return;
      }
      setJsonText(JSON.stringify(accounts, null, 2));
      setLoaded({ files: jsonFiles.length, accounts: accounts.length });
    } catch (err) {
      setParseError(`${translate("Error reading files")}: ${err.message}`);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer?.files?.length > 0) processFiles(e.dataTransfer.files);
  };

  const handleSubmit = async () => {
    setParseError("");
    setResult(null);

    let accounts;
    try {
      accounts = parseAccountsInput(jsonText);
    } catch (err) {
      setParseError(`${translate("Invalid JSON")}: ${err.message}`);
      return;
    }
    if (accounts.length === 0) {
      setParseError(translate("No accounts found in input"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/oauth/grok-cli/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts }),
      });
      const data = await res.json();
      if (!res.ok) {
        setParseError(data?.error || `Request failed: ${res.status}`);
        return;
      }
      setResult(data);
      if (data.success > 0 && typeof onSuccess === "function") {
        onSuccess();
      }
    } catch (err) {
      setParseError(err.message || translate("Request failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const failedItems = result?.results?.filter((r) => !r.ok) || [];

  return (
    <Modal isOpen={isOpen} title={translate("Bulk Add Grok CLI Accounts")} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-text-muted">
            {translate(
              "Paste an array of Grok CLI account JSON objects, or upload the .json files. Each must include access_token."
            )}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            multiple
            className="hidden"
            aria-label={translate("Choose Grok CLI account JSON files")}
            onChange={(e) => {
              processFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            icon="upload_file"
            onClick={() => fileInputRef.current?.click()}
            disabled={submitting}
          >
            {translate("Upload JSON Files")}
          </Button>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
          }}
          onDrop={handleDrop}
          className={`relative rounded border ${
            isDragging ? "border-brand bg-brand/10" : "border-accent/30 bg-sidebar"
          }`}
        >
          <textarea
            className="focus-ring w-full rounded bg-transparent p-2 text-sm font-mono resize-y min-h-[240px]"
            placeholder={PLACEHOLDER}
            aria-label={translate("Grok CLI accounts JSON")}
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setLoaded(null);
            }}
            disabled={submitting}
          />
          {isDragging && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center rounded bg-sidebar/90">
              <span aria-hidden="true" className="material-symbols-outlined text-3xl text-brand">upload_file</span>
              <span className="text-sm font-medium text-brand">{translate("Drop .json files here")}</span>
            </div>
          )}
        </div>

        {loaded && (
          <p className="text-xs text-success">
            {translate("Loaded")} {loaded.accounts} {translate("account(s) from")} {loaded.files}{" "}
            {translate("file(s)")}
          </p>
        )}

        {parseError && <p className="text-xs text-danger break-words">{parseError}</p>}

        {result && (
          <div className="flex flex-col gap-2">
            <div
              className={`text-sm font-medium ${
                result.failed > 0 ? "text-warning" : "text-success"
              }`}
            >
              ✓ {result.success} {translate("added")}
              {result.failed > 0 ? `, ✗ ${result.failed} ${translate("failed")}` : ""}
            </div>
            {failedItems.length > 0 && (
              <ul className="rounded border border-accent/20 bg-sidebar/50 p-2 text-xs font-mono max-h-40 overflow-y-auto">
                {failedItems.map((item) => (
                  <li key={item.index} className="text-danger">
                    [{item.index}] {item.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={submitting || !jsonText.trim()}>
            {submitting ? translate("Importing...") : translate("Import All")}
          </Button>
          <Button onClick={handleClose} variant="ghost" fullWidth disabled={submitting}>
            {translate("Close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

BulkImportGrokCliModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};
