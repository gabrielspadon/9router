"use client";

/** Inline tooltip, Claude Code CLI style */
export default function Tooltip({ text }) {
  return (
    <span
      className="focus-ring relative group inline-flex items-center rounded"
      tabIndex={0}
      role="note"
      aria-label={text}
    >
      <span className="material-symbols-outlined text-[14px] text-text-muted cursor-help" aria-hidden="true">help</span>
      <span className="pointer-events-none absolute start-5 top-1/2 -translate-y-1/2 z-50 w-64 rounded border border-border bg-surface text-text-main text-xs px-3 py-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 shadow-elev">
        {text}
      </span>
    </span>
  );
}
