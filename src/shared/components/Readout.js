"use client";

import { cn } from "@/shared/utils/cn";

// One quantity with its label and unit. Large type is reserved for a number
// that answers a question, so a Readout is only correct where the figure is
// load bearing. Quantities are tabular, always.
const sizes = {
  sm: "text-base",
  md: "text-xl",
  lg: "text-3xl",
};

export default function Readout({
  label,
  value,
  unit,
  tone = "default",
  size = "md",
  className,
  ...props
}) {
  return (
    <div className={cn("min-w-0", className)} {...props}>
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
        {label}
      </div>
      <div
        className={cn(
          "font-mono tabular-nums leading-tight",
          sizes[size] || sizes.md,
          tone === "danger" && "text-danger",
          tone === "warning" && "text-warning",
          tone === "accent" && "text-brand",
          tone === "default" && "text-text-main",
        )}
      >
        {value}
        {unit ? (
          <span className="ms-1 text-xs text-text-muted">{unit}</span>
        ) : null}
      </div>
    </div>
  );
}
