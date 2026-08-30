"use client";

import { useCallback, useEffect, useState } from "react";
import PropTypes from "prop-types";
import Badge from "./Badge";
import Input from "./Input";
import {
  parseConnectTimeoutDraft,
  saveConnectTimeout,
} from "../utils/connectTimeoutInput";

const toDraft = (input) => input == null ? "" : String(input);

export default function ConnectTimeoutInput({
  value,
  providerId,
  disabled = false,
  onSaved,
}) {
  const [draft, setDraft] = useState(() => toDraft(value));
  const [confirmed, setConfirmed] = useState(() => toDraft(value));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });

  useEffect(() => {
    const next = toDraft(value);
    // The component keeps a local draft, so a server-confirmed prop change must replace it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(next);
    setConfirmed(next);
    setStatus({ type: "", message: "" });
  }, [value]);

  const commit = useCallback(async () => {
    if (saving) return;
    const parsed = parseConnectTimeoutDraft(draft, { provider: !!providerId });
    if (!parsed.ok) {
      setDraft(confirmed);
      setStatus({ type: "error", message: parsed.error });
      return;
    }
    setSaving(true);
    setStatus({ type: "", message: "" });
    try {
      const result = await saveConnectTimeout({ providerId, value: parsed.value });
      const canonical = result.confirmed == null ? "" : String(result.confirmed);
      setConfirmed(canonical);
      setDraft(canonical);
      setStatus({ type: "success", message: "Saved" });
      onSaved?.(result.confirmed, result.settings);
    } catch (error) {
      setDraft(confirmed);
      setStatus({ type: "error", message: error.message });
    } finally {
      setSaving(false);
    }
  }, [confirmed, draft, onSaved, providerId, saving]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2">
        <Input
          label="Response header timeout (ms)"
          type="number"
          min="1000"
          max="120000"
          step="1000"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setStatus({ type: "", message: "" });
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          disabled={disabled || saving}
          className="flex-1"
        />
        {status.type === "success" && (
          <Badge variant="success" size="sm">{status.message}</Badge>
        )}
      </div>
      <p className="text-xs text-text-muted">
        {providerId
          ? "Upstream response headers, 1000 to 120000 ms. Empty uses the registry or global default."
          : "Upstream response headers, 1000 to 120000 ms. Empty uses 15000."}
      </p>
      {status.type === "error" && (
        <p className="text-xs text-red-500">{status.message}</p>
      )}
    </div>
  );
}

ConnectTimeoutInput.propTypes = {
  value: PropTypes.number,
  providerId: PropTypes.string,
  disabled: PropTypes.bool,
  onSaved: PropTypes.func,
};
