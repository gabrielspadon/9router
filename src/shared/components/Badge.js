"use client";

import { cn } from "@/shared/utils/cn";

// The status vocabulary. Meaning is fixed product-wide and is not renegotiated
// per page: success = healthy/connected/valid, warning = degraded/expiring,
// danger = failed/expired/revoked, info = neutral notice with no health
// meaning, neutral = a plain label, brand = brand mark, never a status.
// See docs/design/design-system.md section 1.
const variants = {
  success: "bg-success-soft text-success border-success-line",
  warning: "bg-warning-soft text-warning border-warning-line",
  danger: "bg-danger-soft text-danger border-danger-line",
  info: "bg-info-soft text-info border-info-line",
  neutral: "bg-surface-2 text-text-muted border-border",
  brand: "bg-brand-soft text-brand border-brand-line",
};

// Solid tone, for the rare badge that has to read at a glance across a table.
const solidVariants = {
  success: "bg-success-solid text-success-on border-success-solid",
  warning: "bg-warning-solid text-warning-on border-warning-solid",
  danger: "bg-danger-solid text-danger-on border-danger-solid",
  info: "bg-info-solid text-info-on border-info-solid",
  neutral: "bg-surface-3 text-text-main border-surface-3",
  brand: "bg-brand-solid text-brand-on border-brand-solid",
};

// Deprecated aliases kept so existing call sites keep rendering while they are
// migrated: default -> neutral, error -> danger, primary -> brand.
const aliases = {
  default: "neutral",
  error: "danger",
  primary: "brand",
};

// A health state is never carried by hue alone. Each one has a glyph partner,
// so the badge still reads correctly in greyscale and to a colour-blind user.
const statusIcons = {
  success: "check_circle",
  warning: "warning",
  danger: "error",
  info: "info",
};

const sizes = {
  sm: "px-2 py-1 font-mono text-[10.5px]",
  md: "px-3 py-1 text-xs",
  lg: "px-3 py-1.5 text-sm",
};

// The glyph tracks the chip's text size so a small badge does not read as an
// icon with a caption.
const iconSizes = {
  sm: "text-xs",
  md: "text-[14px]",
  lg: "text-[16px]",
};

export default function Badge({
  children,
  variant = "neutral",
  size = "md",
  solid = false,
  dot = false,
  icon,
  className,
}) {
  const resolved = aliases[variant] || variant;
  const tone = (solid ? solidVariants : variants)[resolved] || variants.neutral;
  // An explicit icon wins; otherwise a health state supplies its own. The dot
  // only survives where no glyph is carrying the meaning.
  const glyph = icon || statusIcons[resolved];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold",
        tone,
        sizes[size] || sizes.md,
        className
      )}
    >
      {dot && !glyph && (
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", resolved === "brand" ? "bg-brand" : "bg-text-subtle")}
        />
      )}
      {glyph && (
        <span aria-hidden="true" className={cn("material-symbols-outlined", iconSizes[size] || iconSizes.md)}>{glyph}</span>
      )}
      {children}
    </span>
  );
}
