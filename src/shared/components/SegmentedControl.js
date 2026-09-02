"use client";

import { cn } from "@/shared/utils/cn";

export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  className,
}) {
  // `chip` is the drawn segment; `pad` is the track padding that gives the
  // chip's `hit-44` overlay room to reach 44. `overflow-x-auto` makes the
  // track a scroll container on both axes, which clips the overlay, so the
  // track height carries the floor while the chip stays dense.
  const sizes = {
    sm: { chip: "h-7 text-xs", pad: "px-1 py-2" },
    md: { chip: "h-9 text-sm", pad: "p-1" },
    lg: { chip: "h-11 text-sm", pad: "p-1" },
  };
  const { chip, pad } = sizes[size] || sizes.md;

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-[var(--radius-brand)] overflow-x-auto",
        pad,
        "bg-surface-2",
        className
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "focus-ring hit-44 shrink-0 px-4 rounded-[var(--radius-brand)] font-medium transition-colors duration-150",
            chip,
            value === option.value
              ? "bg-surface text-text-main"
              : "text-text-muted hover:text-text-main"
          )}
        >
          {option.icon && (
            <span aria-hidden="true" className="material-symbols-outlined text-[16px] me-1.5">
              {option.icon}
            </span>
          )}
          {option.label}
        </button>
      ))}
    </div>
  );
}
