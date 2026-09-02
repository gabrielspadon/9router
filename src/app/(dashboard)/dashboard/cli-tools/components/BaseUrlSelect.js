"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UPDATER_CONFIG } from "@/shared/constants/config";
import Button from "@/shared/components/Button";

const PRESETS_KEY = "tokenproxy.cliToolUrlPresets.v1";
const LAST_CUSTOM_KEY = "tokenproxy.cliToolLastCustomUrl.v1";
const LEGACY_PRESETS_KEY = "tokenproxy.cliToolEndpointPresets";
const CUSTOM_VALUE = "__custom__";
const SAVE_VALUE = "__save__";

function isSafeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return (url.protocol === "http:" || url.protocol === "https:")
      && Boolean(url.hostname)
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function normalizePreset(record) {
  if (!record || typeof record !== "object") return null;
  const prototype = Object.getPrototypeOf(record);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(record);
  if (keys.length !== 2 || !keys.includes("name") || !keys.includes("baseUrl")) return null;
  if (typeof record.name !== "string" || typeof record.baseUrl !== "string") return null;
  const name = record.name.trim();
  const baseUrl = record.baseUrl.trim();
  if (!name || !isSafeBaseUrl(baseUrl)) return null;
  return { name, baseUrl };
}

function parsePresetList(raw) {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.map(normalizePreset).filter(Boolean);
}

function readPresetStorage(storage) {
  if (!storage || typeof storage.getItem !== "function") return [];
  let raw;
  try {
    raw = storage.getItem(PRESETS_KEY);
  } catch {
    return [];
  }

  if (raw === null) {
    let legacyRaw = null;
    try {
      legacyRaw = storage.getItem(LEGACY_PRESETS_KEY);
    } catch {
      return [];
    }
    const presets = parsePresetList(legacyRaw);
    try {
      storage.setItem(PRESETS_KEY, JSON.stringify(presets));
    } catch {
      // Storage quota and private-mode errors are intentionally fail-soft.
    }
    return presets;
  }

  if (typeof raw === "string") {
    try {
      JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const presets = parsePresetList(raw);
  try {
    storage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // Storage quota and private-mode errors are intentionally fail-soft.
  }
  return presets;
}

function readLastCustomUrl(storage) {
  if (!storage || typeof storage.getItem !== "function") return "";
  let value;
  try {
    value = storage.getItem(LAST_CUSTOM_KEY);
  } catch {
    return "";
  }
  if (value === null) return "";
  if (isSafeBaseUrl(value)) return value.trim();
  if (typeof storage.removeItem === "function") {
    try {
      storage.removeItem(LAST_CUSTOM_KEY);
    } catch {
      // Storage errors are intentionally fail-soft.
    }
  }
  return "";
}

function writeLastCustomUrl(storage, value) {
  if (!storage || typeof storage.setItem !== "function" || !isSafeBaseUrl(value)) return;
  try {
    storage.setItem(LAST_CUSTOM_KEY, value.trim());
  } catch {
    // Storage quota and private-mode errors are intentionally fail-soft.
  }
}

function formatBaseUrl(url, withV1 = true) {
  const trimmed = typeof url === "string" ? url.trim().replace(/\/+$/, "") : "";
  if (!trimmed) return "";
  if (!withV1) return trimmed;
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

function getCustomSeed(currentValue, persistedValue) {
  if (typeof currentValue === "string" && currentValue.trim()) return currentValue.trim();
  if (isSafeBaseUrl(persistedValue)) return persistedValue.trim();
  return "";
}

function getPresetLabel(preset) {
  if (!preset || typeof preset.name !== "string" || typeof preset.baseUrl !== "string") return "";
  return preset.name === preset.baseUrl ? preset.name : `${preset.name} - ${preset.baseUrl}`;
}

function savePreset(presets, record) {
  const normalized = normalizePreset(record);
  const existing = Array.isArray(presets) ? presets.map(normalizePreset).filter(Boolean) : [];
  if (!normalized) return existing.sort((a, b) => a.name.localeCompare(b.name));
  return [...existing.filter((preset) => preset.name !== normalized.name), normalized]
    .sort((a, b) => a.name.localeCompare(b.name));
}

function deletePreset(presets, name) {
  if (!Array.isArray(presets)) return [];
  return presets.map(normalizePreset).filter(Boolean).filter((preset) => preset.name !== name);
}

function getSavedOption(preset, withV1 = true) {
  const formattedUrl = formatBaseUrl(preset.baseUrl, withV1);
  return {
    value: `saved:${preset.name}`,
    label: getPresetLabel({ ...preset, baseUrl: formattedUrl }),
    url: formattedUrl,
    saved: true,
  };
}

function getSelectedUrl(preset, withV1 = true) {
  return formatBaseUrl(preset.baseUrl, withV1);
}

function getStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const __test__ = {
  isSafeBaseUrl,
  normalizePreset,
  parsePresetList,
  readPresetStorage,
  readLastCustomUrl,
  writeLastCustomUrl,
  formatBaseUrl,
  getCustomSeed,
  getPresetLabel,
  savePreset,
  deletePreset,
  getSavedOption,
  getSelectedUrl,
};

const buildOptions = ({ requiresExternalUrl, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl, cloudEnabled, cloudUrl, savedPresets, withV1 }) => {
  const opts = [];
  const wrap = (url) => formatBaseUrl(url, withV1);
  if (!requiresExternalUrl) {
    const localUrl = wrap(`http://127.0.0.1:${UPDATER_CONFIG.appPort}`);
    opts.push({ value: "local", label: localUrl, url: localUrl });
  }
  if (tunnelEnabled && tunnelPublicUrl) {
    const url = wrap(tunnelPublicUrl);
    opts.push({ value: "tunnel", label: url, url });
  }
  if (tailscaleEnabled && tailscaleUrl) {
    const url = wrap(tailscaleUrl);
    opts.push({ value: "tailscale", label: url, url });
  }
  if (cloudEnabled && cloudUrl) {
    const url = wrap(cloudUrl);
    opts.push({ value: "cloud", label: url, url });
  }
  savedPresets.forEach((preset) => opts.push(getSavedOption(preset, withV1)));
  opts.push({ value: CUSTOM_VALUE, label: "Custom URL...", url: "" });
  return opts;
};

export { __test__ };

export default function BaseUrlSelect({
  value,
  onChange,
  requiresExternalUrl = false,
  tunnelEnabled = false,
  tunnelPublicUrl = "",
  tailscaleEnabled = false,
  tailscaleUrl = "",
  cloudEnabled = false,
  cloudUrl = "",
  withV1 = true,
  className = "",
}) {
  const [savedPresets, setSavedPresets] = useState([]);
  const [mode, setMode] = useState("");
  const [customInput, setCustomInput] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const initializedRef = useRef(false);
  const customSeededRef = useRef(false);

  const storage = getStorage();

  useEffect(() => {
    // Browser storage is an external source and is unavailable during SSR.
    if (customSeededRef.current) return;
    customSeededRef.current = true;
    setSavedPresets(readPresetStorage(storage));
    setCustomInput(getCustomSeed(value, readLastCustomUrl(storage)));
    setStorageReady(true);
  }, [storage, value]);

  const options = useMemo(
    () => buildOptions({ requiresExternalUrl, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl, cloudEnabled, cloudUrl, savedPresets, withV1 }),
    [requiresExternalUrl, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl, cloudEnabled, cloudUrl, savedPresets, withV1]
  );

  useEffect(() => {
    if (!storageReady || initializedRef.current || options.length === 0) return;
    initializedRef.current = true;
    const first = options.find((option) => option.value !== CUSTOM_VALUE && !option.saved);
    if (first) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode(first.value);
      onChange(first.url);
    } else {
      setMode(CUSTOM_VALUE);
      onChange(customInput);
    }
  }, [customInput, onChange, options, storageReady]);

  const handleSelect = (event) => {
    const next = event.target.value;
    if (next === SAVE_VALUE) {
      const trimmed = typeof customInput === "string" ? customInput.trim() : "";
      if (!isSafeBaseUrl(trimmed)) return;
      let defaultName = trimmed;
      try { defaultName = new URL(trimmed).host; } catch { /* validated above */ }
      const name = window.prompt("Save endpoint as:", defaultName);
      if (!name?.trim()) return;
      const updated = savePreset(savedPresets, { name, baseUrl: trimmed });
      const saved = updated.find((preset) => preset.name === name.trim());
      if (!saved) return;
      setSavedPresets(updated);
      try { storage?.setItem(PRESETS_KEY, JSON.stringify(updated)); } catch { /* fail soft */ }
      setMode(`saved:${saved.name}`);
      onChange(formatBaseUrl(saved.baseUrl, withV1));
      return;
    }

    setMode(next);
    if (next === CUSTOM_VALUE) {
      const seed = getCustomSeed(value, readLastCustomUrl(storage));
      setCustomInput(seed);
      onChange(seed);
      return;
    }
    const option = options.find((item) => item.value === next);
    if (option) onChange(option.url);
  };

  const handleCustomInput = (event) => {
    const next = event.target.value;
    setCustomInput(next);
    onChange(next);
    writeLastCustomUrl(storage, next);
  };

  const handleDeleteSaved = () => {
    if (!mode.startsWith("saved:")) return;
    const updated = deletePreset(savedPresets, mode.slice(6));
    setSavedPresets(updated);
    try { storage?.setItem(PRESETS_KEY, JSON.stringify(updated)); } catch { /* fail soft */ }
    const seed = getCustomSeed(customInput, readLastCustomUrl(storage));
    setMode(CUSTOM_VALUE);
    setCustomInput(seed);
    onChange(seed);
  };

  const isSaved = mode.startsWith("saved:");
  const isCustom = mode === CUSTOM_VALUE;
  const canSave = isCustom && isSafeBaseUrl(customInput);

  return (
    <div className={`flex flex-col gap-1.5${className ? ` ${className}` : ""}`}>
      <div className="flex items-center gap-2">
        <select
          value={mode}
          onChange={handleSelect}
          className="flex-1 min-w-0 px-2 py-2 bg-surface rounded text-xs border border-border focus-ring sm:py-1.5"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
          {canSave && <option value={SAVE_VALUE}>+ Save current as...</option>}
        </select>
        {isSaved && (
          <Button variant="bare" size="icon-sm" type="button" onClick={handleDeleteSaved} aria-label="Delete saved endpoint" className="text-text-muted hover:text-danger shrink-0" title="Delete saved endpoint">
            <span aria-hidden="true" className="material-symbols-outlined text-[14px]">delete</span>
          </Button>
        )}
      </div>
      {isCustom && (
        <input
          type="text"
          value={customInput}
          onChange={handleCustomInput}
          placeholder={withV1 ? "https://example.com/v1" : "https://example.com"}
          className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus-ring sm:py-1.5"
        />
      )}
    </div>
  );
}
