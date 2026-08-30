"use client";

import { cn } from "@/shared/utils/cn";

export default function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "md",
  className,
}) {
  const sizes = {
    sm: "h-7 text-xs",
    md: "h-9 text-sm",
    lg: "h-11 text-sm",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center p-1 rounded-[var(--radius-brand)] overflow-x-auto",
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
            "focus-ring shrink-0 px-4 rounded-[8px] font-medium transition-colors duration-150",
            sizes[size],
            value === option.value
              ? "bg-surface text-text-main shadow-soft"
              : "text-text-muted hover:text-text-main"
          )}
        >
          {option.icon && (
            <span className="material-symbols-outlined text-[16px] mr-1.5">
              {option.icon}
            </span>
          )}
          {option.label}
        </button>
      ))}
    </div>
  );
}
