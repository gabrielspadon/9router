"use client";

import { cn } from "@/shared/utils/cn";

export default function Select({
  label,
  options = [],
  value,
  onChange,
  placeholder = "Select an option",
  error,
  hint,
  disabled = false,
  required = false,
  className,
  selectClassName,
  ...props
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label className="text-sm font-medium text-text-main">
          {label}
          {required && <span className="text-danger ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        <select
          value={value}
          onChange={onChange}
          disabled={disabled}
          aria-invalid={error ? "true" : undefined}
          aria-label={typeof label === "string" ? label : undefined}
          className={cn(
            // One field treatment, shared with Input. The ring is the
            // product-wide focus-ring utility; error recolours the border only.
            "focus-ring w-full py-2.5 px-3 pr-10 text-text-main",
            "bg-surface border border-border rounded-[var(--radius-brand)] appearance-none",
            "transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
            "text-[16px] sm:text-sm",
            error && "border-danger",
            selectClassName
          )}
          {...props}
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-text-muted">
          <span aria-hidden="true" className="material-symbols-outlined text-[20px]">expand_more</span>
        </div>
      </div>
      {error && (
        <p className="text-xs text-danger flex items-center gap-1">
          <span aria-hidden="true" className="material-symbols-outlined text-[14px]">error</span>
          {error}
        </p>
      )}
      {hint && !error && (
        <p className="text-xs text-text-muted">{hint}</p>
      )}
    </div>
  );
}
