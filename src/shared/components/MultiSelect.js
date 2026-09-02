"use client";

import { useState, useRef, useEffect, useId } from "react";
import { cn } from "@/shared/utils/cn";

// Multi-select dropdown. value is an array of option values; "all" means every
// option is selected (sentinel rendered as a "All X" chip). Toggling the last
// selected option drops back to "all" so the user can always return to
// selecting everything — mirroring the summary-card default.
export default function MultiSelect({
  label,
  options = [],
  value = [],
  onChange,
  placeholder = "All",
  className,
  allLabel,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const buttonId = useId();
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const optionSet = new Set(options.map((o) => o.value));
  const selected = (value || []).filter((v) => optionSet.has(v));
  const allSelected = selected.length === 0 || selected.length === options.length;

  const toggle = (v) => {
    let next;
    if (selected.includes(v)) {
      // Removing the last one collapses back to "all".
      next = selected.length <= 1 ? [] : selected.filter((x) => x !== v);
    } else {
      next = [...selected, v];
      if (next.length === options.length) next = []; // reaching all → treat as all
    }
    onChange(next);
  };

  const summary = allSelected || selected.length === 0
    ? (allLabel || `All ${label || ""}`.trim())
    : `${selected.length} ${label || "items"} selected`;

  return (
    <div className={cn("relative flex flex-col gap-1.5", className)} ref={ref}>
      {label && (
        <label htmlFor={buttonId} className="text-sm font-medium text-text-main">{label}</label>
      )}
      <button
        id={buttonId}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={listboxId}
        className={cn(
          "focus-ring w-full min-h-11 px-3 flex items-center justify-between gap-2 text-sm",
          "bg-surface border border-border rounded-[var(--radius-brand)]",
          "transition-colors duration-150 cursor-pointer hover:border-brand-line",
          open && "border-brand-line"
        )}
      >
        <span className={cn(selected.length === 0 || allSelected ? "text-text-muted" : "text-text-main")}>
          {summary}
        </span>
        <span aria-hidden="true" className="material-symbols-outlined text-[20px] text-text-muted">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && (
        <div
          id={listboxId}
          role="group"
          aria-labelledby={buttonId}
          className="absolute top-full start-0 end-0 z-30 mt-1 rounded-[var(--radius-brand)] border border-border bg-surface shadow-elev max-h-64 overflow-auto py-1"
        >
          <button
            type="button"
            onClick={() => { onChange([]); }}
            aria-pressed={allSelected}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-2 text-sm text-start hover:bg-surface-2/60 cursor-pointer",
              allSelected ? "text-text-main" : "text-text-muted"
            )}
          >
            <span
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded border",
                allSelected ? "bg-brand-solid border-brand-solid text-brand-on" : "border-border"
              )}
            >
              {allSelected && <span aria-hidden="true" className="material-symbols-outlined text-[13px]">check</span>}
            </span>
            {allLabel || "Select all"}
          </button>
          {options.map((o) => {
            const isSel = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                aria-pressed={isSel}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-start text-text-main hover:bg-surface-2/60 cursor-pointer"
              >
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded border",
                    isSel ? "bg-brand-solid border-brand-solid text-brand-on" : "border-border"
                  )}
                >
                  {isSel && <span aria-hidden="true" className="material-symbols-outlined text-[13px]">check</span>}
                </span>
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
