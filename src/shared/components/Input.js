"use client";

import { cn } from "@/shared/utils/cn";

export default function Input({
  label,
  type = "text",
  placeholder,
  value,
  onChange,
  error,
  hint,
  icon,
  disabled = false,
  required = false,
  className,
  inputClassName,
  ...props
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label className="text-sm font-medium text-text-main">
          {label}
          {required && <span className="text-danger ms-1">*</span>}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute inset-y-0 start-0 flex items-center ps-3 pointer-events-none text-text-muted">
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">{icon}</span>
          </div>
        )}
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          disabled={disabled}
          aria-invalid={error ? "true" : undefined}
          aria-label={typeof label === "string" ? label : undefined}
          className={cn(
            // One field treatment, shared with Select. The ring is the
            // product-wide focus-ring utility; error recolours the border only.
            "focus-ring w-full min-h-11 py-3 px-3 text-text-main bg-surface rounded-[var(--radius-brand)]",
            "border border-border placeholder-text-muted/70",
            "transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
            // iOS zoom fix
            "text-[16px] sm:text-sm",
            // The icon sits at 12px and is 20px wide, so it ends at 32px. The
            // field has to clear it by a scale step, and 16 is the first that
            // does not read as a collision: 12 + 20 + 16 = 48. Left as a literal
            // rather than derived because all three numbers are on the scale and
            // a computed value would be off it.
            icon && "ps-12",
            error && "border-danger",
            inputClassName
          )}
          {...props}
        />
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
