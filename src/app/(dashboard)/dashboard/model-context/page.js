"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, Button, Input, MultiSelect, SegmentedControl } from "@/shared/components";
import { invalidateModelCaps } from "@/shared/hooks/useModelCaps.js";

// Context-window management table. One row = one registered model's effective
// contextWindow. The default view is the in-use world (providers with an active
// connection first); the rest is reachable via filters (status / coverage /
// connection / window range). Overrides are the exceptional state and are
// rendered inline on their rows instead of a separate list.
//
// Override resolution mirrors applyContextOverrides() in
// open-sse/providers/capabilities.js exactly:
//   scoped "provider/model" > bare model id > exact model-with-slash > glob
//   (glob: first matching key in insertion order; case-insensitive per
//   matchPattern() in open-sse/providers/pricing.js)

const HIDDEN_KEY = "mcHiddenModels"; // localStorage: ["provider/model", …]
const ROW_CAP = 250; // initial render cap; "show all N" below the table

function globToRegex(pattern) {
  return new RegExp(
    "^" +
      pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") +
      "$",
    "i" // matchPattern() is case-insensitive
  );
}

// Accepts 200k / 1m / 1.5m / 128000 → positive int | null.
function parseWindow(str) {
  const m = /^([\d,.]+)\s*([km])?$/i.exec((str || "").trim());
  if (!m || !m[1]) return null;
  const num = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num) || num <= 0) return null;
  const mult = m[2] ? { k: 1000, m: 1000000 }[m[2].toLowerCase()] : 1;
  const v = Math.round(num * mult);
  return v > 0 ? v : null;
}

function fmtInt(n) {
  return n == null ? "-" : Number(n).toLocaleString();
}

function baseModelOf(model) {
  return model.includes("/") ? model.split("/").pop() : model;
}

// Which override (if any) controls this model — same precedence as the engine.
function resolveSource(overrides, provider, model) {
  const baseModel = baseModelOf(model);
  const fullKey = `${provider}/${baseModel}`;
  if (overrides[fullKey] != null) return { type: "scoped", key: fullKey, value: overrides[fullKey] };
  if (overrides[baseModel] != null) return { type: "bare", key: baseModel, value: overrides[baseModel] };
  if (overrides[model] != null) return { type: "scoped", key: model, value: overrides[model] };
  for (const [k, v] of Object.entries(overrides)) {
    if (!k.includes("*")) continue;
    try {
      const re = globToRegex(k);
      if (re.test(fullKey) || re.test(baseModel)) return { type: "glob", key: k, value: v };
    } catch {
      /* invalid glob — the engine ignores it too */
    }
  }
  return null;
}

function ModelContextPage() {
  // Data
  const [overrides, setOverrides] = useState({});
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Filters
  const [q, setQ] = useState("");
  const [providersSel, setProvidersSel] = useState([]);
  // Default to the in-use world (models actually exposed in /v1/models);
  // click Status again (or Inactive) to see the dormant catalog.
  const [statusF, setStatusF] = useState("active"); // all | active | inactive
  const [covF, setCovF] = useState("all"); // all | covered | uncovered
  const [connF, setConnF] = useState("all"); // all | yes | no
  const [minW, setMinW] = useState("");
  const [maxW, setMaxW] = useState("");

  // Table interactions
  const [sort, setSort] = useState({ key: null, dir: 1 }); // key: eff | model | provider
  const [selected, setSelected] = useState(() => new Set()); // row fullKeys
  const [editing, setEditing] = useState(null); // { rowKey, value }
  const [notice, setNotice] = useState("");

  // Hidden models (view-layer noise reduction)
  const [hidden, setHidden] = useState(() => new Set());
  const [hiddenView, setHiddenView] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Panels & form
  const [keysOpen, setKeysOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [batchVal, setBatchVal] = useState("");
  const [formKey, setFormKey] = useState("");
  const [formWindow, setFormWindow] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/model-context", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load");
        if (cancelled) return;
        setOverrides(data.overrides || {});
        setModels(data.models || []);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Deferred hydrate of hidden models (avoids SSR/CSR mismatch).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(HIDDEN_KEY);
        if (raw) setHidden(new Set(JSON.parse(raw)));
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const persistHidden = (next) => {
    setHidden(next);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
    } catch {}
    // Restoring the last hidden row shouldn't strand the user in an empty
    // reverse view — drop back to the normal list.
    if (next.size === 0) setHiddenView(false);
  };

  const providerOptions = useMemo(() => {
    const seen = new Map();
    for (const m of models) {
      if (!seen.has(m.provider)) seen.set(m.provider, m.providerName || m.provider);
    }
    return [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));
  }, [models]);

  // Effective rows + per-key hit counts (orphan detection for the keys panel).
  const rowsData = useMemo(() => {
    const list = [];
    const hits = {};
    for (const m of models) {
      const src = resolveSource(overrides, m.provider, m.model);
      const base = m.staticContextWindow ?? m.contextWindow;
      const eff = src ? src.value : base;
      if (src) hits[src.key] = (hits[src.key] || 0) + 1;
      list.push({
        fullKey: `${m.provider}/${baseModelOf(m.model)}`,
        provider: m.provider,
        providerName: m.providerName,
        providerActive: m.providerActive,
        // Model-level enablement (in /v1/models), not just "provider has an
        // enabled connection" — a connected provider may only expose a few.
        enabledModel: m.defaultVisible ?? false,
        providerConnections: m.providerConnections ?? 0,
        model: m.model,
        name: m.name,
        base,
        eff,
        src,
      });
    }
    return { list, hits };
  }, [models, overrides]);




  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const lo = parseWindow(minW);
    const hi = parseWindow(maxW);
    let list = rowsData.list;

    // Hidden gating first: default mode drops hidden rows entirely; the
    // reverse view shows ONLY hidden rows (restore is one click away).
    if (hiddenView) list = list.filter((r) => hidden.has(r.fullKey));
    else list = list.filter((r) => !hidden.has(r.fullKey));

    if (needle) {
      list = list.filter(
        (r) =>
          r.model.toLowerCase().includes(needle) ||
          (r.name || "").toLowerCase().includes(needle) ||
          r.provider.toLowerCase().includes(needle) ||
          (r.providerName || "").toLowerCase().includes(needle)
      );
    }
    if (providersSel.length) list = list.filter((r) => providersSel.includes(r.provider));
    if (statusF === "active") list = list.filter((r) => r.enabledModel);
    if (statusF === "inactive") list = list.filter((r) => !r.enabledModel);
    if (covF === "covered") list = list.filter((r) => r.src);
    if (covF === "uncovered") list = list.filter((r) => !r.src);
    if (connF === "yes") list = list.filter((r) => r.providerConnections > 0);
    if (connF === "no") list = list.filter((r) => r.providerConnections === 0);
    if (lo != null) list = list.filter((r) => r.eff != null && r.eff >= lo);
    if (hi != null) list = list.filter((r) => r.eff != null && r.eff <= hi);

    // Default order: active-first (the in-use world), then provider, then model.
    const dir = sort.dir;
    if (sort.key === "eff") {
      list.sort((a, b) => ((a.eff ?? -1) - (b.eff ?? -1)) * dir || a.model.localeCompare(b.model));
    } else if (sort.key === "model") {
      list.sort((a, b) => a.model.localeCompare(b.model) * dir);
    } else if (sort.key === "provider") {
      list.sort((a, b) => a.provider.localeCompare(b.provider) * dir || a.model.localeCompare(b.model));
    } else {
      list.sort(
        (a, b) =>
          (b.enabledModel ? 1 : 0) - (a.enabledModel ? 1 : 0) ||
          a.provider.localeCompare(b.provider) ||
          a.model.localeCompare(b.model)
      );
    }
    return list;
  }, [rowsData, hidden, hiddenView, q, providersSel, statusF, covF, connF, minW, maxW, sort]);

  const visible = hiddenView ? filtered : filtered.slice(0, showAll ? filtered.length : ROW_CAP);
  const orphans = useMemo(
    () => Object.keys(overrides).filter((k) => !(rowsData.hits[k] > 0)),
    [overrides, rowsData]
  );
  const coveredCount = Object.keys(overrides).length;

  // ---- actions -----------------------------------------------------------

  const flashNotice = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 4000);
  };

  const saveOverride = async (key, contextWindow) => {
    setSaving(true);
    try {
      const res = await fetch("/api/model-context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, contextWindow }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setOverrides(data.overrides || {});
      invalidateModelCaps();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Multi-key delete via the bulk endpoint (one write + one engine reload).
  const deleteKeysBulk = async (keys) => {
    if (!keys.length) return;
    setSaving(true);
    try {
      const res = await fetch("/api/model-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteKeys: keys }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      setOverrides(data.overrides || {});
      invalidateModelCaps();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (r) => {
    setEditing({ rowKey: r.fullKey, value: r.eff == null ? "" : String(r.eff) });
  };

  // Any row's ✏️ writes a precise scoped override — after saving, scoped has
  // the highest precedence, so the row's effective value becomes this number.
  const commitEdit = async () => {
    if (!editing) return;
    const row = rowsData.list.find((r) => r.fullKey === editing.rowKey);
    if (!row) { setEditing(null); return; }
    const window = parseWindow(editing.value);
    if (window === null) {
      setError("Window must be a positive integer. 200k / 1m shorthand is accepted");
      return;
    }
    if (await saveOverride(row.fullKey, window)) {
      flashNotice(`${row.model} → ${window.toLocaleString()}`);
      setEditing(null);
    }
  };

  // Revert only removes a scoped override. Rows controlled by bare/glob keys
  // can't revert individually (no null override exists) — the controlling key
  // must be removed in the overrides panel.
  const revertRow = async (row) => {
    await deleteKeysBulk([row.src.key]);
    flashNotice(`${row.model} reset to default`);
  };

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const allOn = visible.length > 0 && visible.every((r) => prev.has(r.fullKey));
      return allOn ? new Set() : new Set(visible.map((r) => r.fullKey));
    });
  };

  const toggleRow = (rowKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  // Batch: set every selected row to one value (scoped overrides per row).
  const handleBatchSet = async () => {
    const window = parseWindow(batchVal);
    if (window === null) {
      setError("Window must be a positive integer. 200k / 1m shorthand is accepted");
      return;
    }
    const set = [...selected].map((k) => ({ key: k, contextWindow: window }));
    setSaving(true);
    try {
      const res = await fetch("/api/model-context", {
        method: "POST",
        body: JSON.stringify({ set }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setOverrides(data.overrides || {});
      invalidateModelCaps();
      flashNotice(`Set ${set.length} models → ${window.toLocaleString()}`);
      setSelected(new Set());
      setBatchVal("");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Batch clear: only removes keys the selected rows own outright; rows
  // controlled by bare/glob keys are skipped (deleting those would affect
  // unselected models too).
  const handleBatchClear = async () => {
    const ownKeys = [...selected].map((k) =>
      rowsData.list.find((r) => r.fullKey === k)
    ).filter((r) => r && r.src && r.src.type === "scoped").map((r) => r.src.key);
    const skipped = selected.size - new Set(ownKeys).size;
    await deleteKeysBulk([...new Set(ownKeys)]);
    if (skipped > 0) {
      flashNotice(`Cleared ${ownKeys.length} overrides; ${skipped} are controlled by a global or glob key and were left unchanged`);
    } else {
      flashNotice(`Cleared ${ownKeys.length} overrides`);
    }
    setSelected(new Set());
  };

  const handleBatchHide = () => {
    const next = new Set(hidden);
    for (const k of selected) next.add(k);
    persistHidden(next);
    setSelected(new Set());
    setHiddenView(false);
  };

  // Hide/restore a single row (persists to localStorage via persistHidden).
  const toggleHideRow = (row) => {
    const next = new Set(hidden);
    if (hidden.has(row.fullKey)) next.delete(row.fullKey);
    else next.add(row.fullKey);
    persistHidden(next);
  };

  // Manual add: a bare id, provider-scoped key, or glob — as typed.
  const submitAddForm = async () => {
    const key = formKey.trim();
    const window = parseWindow(formWindow);
    if (!key) { setFormError("Key required"); return; }
    if (window === null) {
      setFormError("Window must be a positive integer. 200k / 1m shorthand is accepted");
      return;
    }
    if (await saveOverride(key, window)) {
      setFormKey("");
      setFormWindow("");
      setFormError("");
      flashNotice(`Added override ${key} → ${window.toLocaleString()}`);
    }
  };

  // Live preview of what a manually entered key would hit (0 = typo warning).
  const formPreview = useMemo(() => {
    const k = formKey.trim();
    if (!k) return null;
    const matches = models.filter((m) => {
      const baseModel = baseModelOf(m.model);
      const full = `${m.provider}/${baseModel}`;
      if (k.includes("*")) {
        try { return globToRegex(k).test(full) || globToRegex(k).test(baseModel); }
        catch { return false; }
      }
      return k === full || k === baseModel || k === m.model;
    });
    return { count: matches.length };
  }, [formKey, models]);

  // Datalist for the manual-add key input: exact scoped keys plus the distinct
  // bare model ids, so "glm-5.3" autocompletes to whatever models exist.
  const keyOptions = useMemo(() => {
    const scoped = Object.keys(overrides).filter((k) => k.includes("/"));
    const bare = new Set(scoped.map((k) => k.slice(k.indexOf("/") + 1)));
    for (const m of models) bare.add(baseModelOf(m.model));
    return [...new Set([...scoped, ...bare])].sort();
  }, [overrides, models]);

  // ---- render ------------------------------------------------------------

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.fullKey));

  const sortIcon = (key) =>
    sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : "";

  const toggleSort = (key) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: -prev.dir } : { key, dir: 1 }
    );
  };

  // Segmented filters act as toggles: click a condition to apply it, click it
  // again to drop back to "all".
  const segToggle = (setter) => (v) =>
    setter((prev) => (prev === v ? "all" : v));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-text-main">Model Context</h1>
        <p className="text-sm text-text-muted mt-1">
          Check the context window on every model and fix the ones that are wrong. Models from active providers come first, which is the set <code>/v1/models</code> currently exposes. Edits apply immediately to routing and to <code>/v1/models</code>.
        </p>
      </div>

      {error && (
        <div className="text-xs text-danger bg-danger-soft border border-danger-line rounded-[var(--radius-brand)] p-4 flex items-start justify-between gap-3">
          <span className="inline-flex min-w-0 items-start gap-2">
            <span className="material-symbols-outlined text-[16px] shrink-0" aria-hidden="true">error</span>
            {error}
          </span>
          <Button
            variant="bare" size="icon-sm"
            onClick={() => setError("")}
            aria-label="Dismiss"
            title="Dismiss"
            className="shrink-0"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">close</span>
          </Button>
        </div>
      )}
      {notice && (
        <div className="text-xs text-success bg-success-soft border border-success-line rounded-[var(--radius-brand)] p-4 inline-flex items-start gap-2">
          <span className="material-symbols-outlined text-[16px] shrink-0" aria-hidden="true">check_circle</span>
          {notice}
        </div>
      )}

      <Card padding="none" className="min-w-0">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border-subtle">
          <Input
            placeholder="Search models / providers…"
            icon="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-48"
          />
          <MultiSelect
            options={providerOptions}
            value={providersSel}
            onChange={(v) => setProvidersSel(v)}
            allLabel="All providers"
            className="w-44"
          />
          <SegmentedControl
            size="sm"
            options={[{ value: "all", label: "Status" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]}
            value={statusF}
            onChange={segToggle(setStatusF)}
          />
          <SegmentedControl
            size="sm"
            options={[{ value: "all", label: "Override" }, { value: "covered", label: "Covered" }, { value: "uncovered", label: "Uncovered" }]}
            value={covF}
            onChange={segToggle(setCovF)}
          />
          {/* connF = the provider has been configured with at least one connection record,
              enabled or not — orthogonal to model enablement. */}
          <span title="Connection = the provider has at least one connection record, including disabled ones. Connected but the model is still inactive → select that model on the provider page">
            <SegmentedControl
              size="sm"
              options={[{ value: "all", label: "Connection" }, { value: "yes", label: "Yes" }, { value: "no", label: "No" }]
              }
              value={connF}
              onChange={segToggle(setConnF)}
            />
          </span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              placeholder="Window ≥"
              value={minW}
              onChange={(e) => setMinW(e.target.value)}
              className="focus-ring h-9 w-24 rounded-[var(--radius-brand)] border border-border bg-surface-2 px-2.5 text-sm text-text-main metric focus:outline-none"
            />
            <input
              type="number"
              placeholder="≤"
              value={maxW}
              onChange={(e) => setMaxW(e.target.value)}
              className="focus-ring h-9 w-16 rounded-[var(--radius-brand)] border border-border bg-surface-2 px-2.5 text-sm text-text-main metric focus:outline-none"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" icon={keysOpen ? "expand_less" : "tune"} onClick={() => setKeysOpen(!keysOpen)}>
              Override keys ({coveredCount})
            </Button>
            <Button size="sm" variant={hiddenView ? "primary" : "ghost"} icon="visibility_off"
              onClick={() => setHiddenView(!hiddenView)}>
              Hidden ({hidden.size})
            </Button>
            <Button size="sm" icon="add" onClick={() => setAddOpen(!addOpen)}>Add</Button>
          </div>
        </div>

        {/* Batch bar */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-brand-soft border-b border-border-subtle">
            <span className="text-sm font-medium text-text-main"><span className="metric">{selected.size}</span> selected</span>
            <input
              type="text"
              placeholder="e.g. 200k / 1m"
              value={batchVal}
              onChange={(e) => setBatchVal(e.target.value)}
              className="focus-ring h-8 w-28 rounded-[var(--radius-brand)] border border-border bg-surface-2 px-2.5 text-sm text-text-main metric focus:outline-none"
            />
            <Button size="sm" onClick={handleBatchSet} disabled={saving}>Set</Button>
            <Button size="sm" variant="ghost" onClick={handleBatchClear} disabled={saving}>
              Clear overrides
            </Button>
          </div>
        )}

        {/* Add override panel */}
        {addOpen && (
          <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-border-subtle bg-surface-2">
            <div className="flex-1 min-w-[240px]">
              <label className="block text-xs text-text-muted mb-1">
                Key (a bare id applies globally, provider/model scopes to one provider, * is a wildcard)
              </label>
              <input
                list="mc-key-options"
                className="focus-ring w-full h-9 rounded-[var(--radius-brand)] border border-border bg-surface-2 px-3 text-sm text-text-main focus:outline-none"
                placeholder="e.g. zhipu/glm-5.3 or glm-*"
                value={formKey}
                onChange={(e) => setFormKey(e.target.value)}
              />
              <datalist id="mc-key-options">
                {keyOptions.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
              {formPreview && (
                <p className={`text-xs mt-1 inline-flex items-center gap-1 ${formPreview.count > 0 ? "text-text-muted" : "text-warning"}`}>
                  {formPreview.count === 0 && (
                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">warning</span>
                  )}
                  Matches <span className="metric">{formPreview.count}</span> models{formPreview.count === 0 && " - check the spelling"}
                </p>
              )}
            </div>
            <div className="w-36">
              <Input label="Window (tokens)" placeholder="e.g. 200k" value={formWindow}
                onChange={(e) => setFormWindow(e.target.value)} />
            </div>
            <Button onClick={submitAddForm} disabled={saving}>Add override</Button>
          </div>
        )}

        {/* Override keys panel (audit + orphan management) */}
        {keysOpen && (
          <div className="px-4 py-3 border-b border-border-subtle bg-surface-2">
            {Object.keys(overrides).length === 0 ? (
              <p className="text-sm text-text-muted">No overrides configured yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {Object.entries(overrides).map(([k, v]) => {
                  const hitCount = rowsData.hits[k] || 0;
                  return (
                    <div key={k} className="flex items-center justify-between gap-3 px-4 py-3 rounded-[var(--radius-brand)] border border-border-subtle bg-surface">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <code className="text-xs font-mono bg-surface-2 text-text-main px-1.5 py-0.5 rounded">{k}</code>
                        <span className="text-sm font-mono text-text-main metric">{fmtInt(v)}</span>
                        {hitCount === 0 && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-danger-soft text-danger">
                            <span className="material-symbols-outlined text-[12px]" aria-hidden="true">error</span>
                            Matches no models
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-text-subtle metric">{hitCount} models</span>
                        <Button
                          variant="bare" size="icon-sm"
                          onClick={() => deleteKeysBulk([k])}
                          disabled={saving}
                          className="hover:bg-danger-soft text-text-muted hover:text-danger"
                          aria-label="Delete this override"
                          title="Delete this override"
                        >
                          <span className="material-symbols-outlined text-sm" aria-hidden="true">close</span>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[880px]">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
                <th scope="col" className="px-4 py-3 w-8">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} aria-label="Select all rows on this page" className="focus-ring h-4 w-4 cursor-pointer accent-brand-500" />
                </th>
                <th scope="col" aria-sort={sort.key === "provider" ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className="px-4 py-3 font-medium">
                  <button className="focus-ring rounded-sm cursor-pointer hover:text-text-main transition-colors duration-150" onClick={() => toggleSort("provider")}>
                    Provider{sortIcon("provider")}
                  </button>
                </th>
                <th scope="col" aria-sort={sort.key === "model" ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className="px-4 py-3 font-medium">
                  <button className="focus-ring rounded-sm cursor-pointer hover:text-text-main transition-colors duration-150" onClick={() => toggleSort("model")}>
                    Model{sortIcon("model")}
                  </button>
                </th>
                <th scope="col" aria-sort={sort.key === "eff" ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className="px-4 py-3 font-medium">
                  <button className="focus-ring rounded-sm cursor-pointer hover:text-text-main transition-colors duration-150" onClick={() => toggleSort("eff")}>
                    Effective window{sortIcon("eff")}
                  </button>
                </th>
                <th scope="col" className="px-4 py-3 font-medium">Source</th>
                <th scope="col" className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-text-muted">Loading…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                  {hiddenView ? "No hidden models." : "No matching models."}
                </td></tr>
              ) : (
                visible.map((r) => (
                  <tr key={r.fullKey} className="border-b border-border-subtle last:border-b-0 hover:bg-surface-2 transition-colors duration-150">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(r.fullKey)} onChange={() => toggleRow(r.fullKey)} aria-label={`Select ${r.fullKey}`} className="focus-ring h-4 w-4 cursor-pointer accent-brand-500" />
                    </td>
                    <td className="px-4 py-3 min-w-0">
                      <span className="text-text-main">{r.providerName}</span>
                      {!r.enabledModel && (
                        <span
                          title={r.providerActive ? "The provider has an enabled connection, but this model is not in /v1/models (not selected)" : "This provider has no enabled connection"}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted ml-1"
                        >
                          Inactive
                        </span>
                      )}
                      <code className="text-[10px] font-mono bg-surface-2 px-1 py-0.5 rounded text-text-muted ml-1">{r.provider}</code>
                    </td>
                    <td className="px-4 py-3 max-w-[260px]">
                      <code className="text-xs font-mono bg-surface-2 text-text-main px-1.5 py-0.5 rounded truncate block">{r.model}</code>
                      {r.name && r.name !== r.model ? <span className="text-[10px] text-text-muted truncate block">{r.name}</span> : null}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap metric">
                      {editing?.rowKey === r.fullKey ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            type="text"
                            value={editing.value}
                            onChange={(e) => setEditing({ rowKey: r.fullKey, value: e.target.value })}
                            onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditing(null); }}
                            className="focus-ring h-7 w-24 rounded-[var(--radius-brand)] border border-border bg-surface-2 px-2 text-xs text-text-main metric focus:outline-none"
                          />
                          <Button
                            variant="primary" size="icon-sm"
                            onClick={commitEdit}
                            aria-label="Confirm (Enter)"
                            title="Confirm (Enter)"
                            className="shrink-0"
                            disabled={saving || editing.value.trim() === ""}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">check</span>
                          </Button>
                          <Button
                            variant="ghost" size="icon-sm"
                            onClick={() => setEditing(null)}
                            aria-label="Cancel (Esc)"
                            title="Cancel (Esc)"
                            className="border border-border shrink-0"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">close</span>
                          </Button>
                        </div>
                      ) : r.src ? (
                        <div>
                          <span className="text-text-main font-semibold">{fmtInt(r.eff)}</span>{" "}
                          <s className="text-text-muted">{fmtInt(r.base)}</s>
                        </div>
                      ) : (
                        <span className="text-text-main">{fmtInt(r.eff)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.src ? (
                        <span title={r.src.key} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-border bg-surface-2 text-text-muted">
                          <span className="material-symbols-outlined text-[12px]" aria-hidden="true">
                            {r.src.type === "scoped" ? "edit" : "public"}
                          </span>
                          {r.src.type === "scoped" ? "Manual" : r.src.type === "bare" ? "Global" : "glob"}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button variant="bare" size="icon-sm" onClick={() => startEdit(r)} aria-label="Edit effective window" title="Edit effective window" className="hover:bg-surface-2 text-text-muted hover:text-brand">
                        <span className="material-symbols-outlined text-sm" aria-hidden="true">edit</span>
                      </Button>
                      {r.src?.type === "scoped" ? (
                        <Button variant="bare" size="icon-sm" onClick={() => revertRow(r)} disabled={saving} aria-label="Reset to default (remove this row's override)" title="Reset to default (remove this row's override)" className="hover:bg-danger-soft text-text-muted hover:text-danger">
                          <span className="material-symbols-outlined text-sm" aria-hidden="true">restart_alt</span>
                        </Button>
                      ) : r.src ? (
                        <span title="Controlled by an override key; manage it in the Override keys panel" className="inline-block p-1 text-text-muted">
                          <span className="material-symbols-outlined text-sm" aria-hidden="true">restart_alt</span>
                        </span>
                      ) : null}
                      <Button variant="bare" size="icon-sm" onClick={() => toggleHideRow(r)} aria-label={hiddenView ? "Unhide" : "Hide this row"} title={hiddenView ? "Unhide" : "Hide this row"} className="hover:bg-surface-2 text-text-muted hover:text-brand">
                        <span className="material-symbols-outlined text-sm" aria-hidden="true">{hiddenView ? "visibility" : "visibility_off"}</span>
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border-subtle text-xs text-text-muted">
          <span className="metric">
            {hiddenView ? `${filtered.length} hidden` : `Showing ${visible.length} / ${filtered.length}`}
            {coveredCount > 0 && hiddenView === false && ` · ${coveredCount} overridden`}
          </span>
          {!hiddenView && !showAll && filtered.length > ROW_CAP && (
            <button onClick={() => setShowAll(true)} className="focus-ring rounded-sm shrink-0 text-brand hover:underline cursor-pointer">
              Show all {filtered.length} rows
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}

export default ModelContextPage;
