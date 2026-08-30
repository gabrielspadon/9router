"use client";

import { cn } from "@/shared/utils/cn";

// Closed variant set. Brand carries primary action, danger carries destruction,
// and nothing else is coloured. See .unlazy/TOKEN-CONTRACT.md section 1.
const variants = {
  primary:
    "bg-brand-solid text-brand-on hover:bg-brand-solid/90 shadow-soft disabled:bg-surface-3 disabled:text-text-muted disabled:shadow-none",
  secondary:
    "bg-surface-2 text-text-main border border-border hover:bg-surface-3 disabled:opacity-50",
  ghost: "text-text-muted hover:bg-surface-2 hover:text-text-main",
  danger:
    "bg-danger-solid text-danger-on hover:bg-danger-solid/90 shadow-soft disabled:bg-surface-3 disabled:text-text-muted disabled:shadow-none",
};

// Deprecated aliases kept so existing call sites keep rendering while they are
// migrated: outline -> secondary, success -> primary. Do not add new uses.
const aliases = {
  outline: "secondary",
  success: "primary",
};

const sizes = {
  sm: "h-7 px-3 text-xs rounded-[8px]",
  md: "h-9 px-4 text-sm rounded-[var(--radius-brand)]",
  lg: "h-11 px-6 text-sm rounded-[var(--radius-brand)]",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  type = "button",
  icon,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  className,
  ...props
}) {
  const resolved = aliases[variant] || variant;
  // An icon beside a label is decoration and is hidden from assistive tech. On
  // an icon-only button the ligature text is the only name left, so it stays.
  const iconHidden = children ? "true" : undefined;
  return (
    <button
      type={type}
      className={cn(
        // `focus-ring` is the product-wide :focus-visible ring built from
        // --shadow-focus in globals.css. It is never removed and never
        // overridden by a caller's className.
        "focus-ring inline-flex items-center justify-center gap-2 font-semibold transition-colors duration-150 cursor-pointer",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variants[resolved] || variants.primary,
        sizes[size] || sizes.md,
        fullWidth && "w-full",
        className
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <span aria-hidden={iconHidden} className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
      ) : icon ? (
        <span aria-hidden={iconHidden} className="material-symbols-outlined text-[18px]">{icon}</span>
      ) : null}
      {children}
      {iconRight && !loading && (
        <span aria-hidden={iconHidden} className="material-symbols-outlined text-[18px]">{iconRight}</span>
      )}
    </button>
  );
}
