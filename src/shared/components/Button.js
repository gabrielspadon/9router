"use client";

import { cn } from "@/shared/utils/cn";

// Closed variant set. Brand carries primary action, danger carries destruction,
// and nothing else is coloured; `bare` colours nothing at all. See
// .unlazy/TOKEN-CONTRACT.md section 1.
const variants = {
  primary:
    "bg-brand-solid text-brand-on hover:bg-brand-solid/90 shadow-soft disabled:bg-surface-3 disabled:text-text-muted disabled:shadow-none",
  secondary:
    "bg-surface-2 text-text-main border border-border hover:bg-surface-3 disabled:opacity-50",
  ghost: "text-text-muted hover:bg-surface-2 hover:text-text-main",
  // No colour opinion at all: the call site owns text and hover colour. Needed
  // because `cn` has no conflict resolution, so a className colour override on a
  // coloured variant silently loses to whichever class Tailwind emitted later
  // (see .unlazy/BACKEND-HANDOFF.md A6). Icon-only affordances that hover to
  // danger or brand use this; everything with a stock colour uses `ghost`.
  bare: "",
  danger:
    "bg-danger-solid text-danger-on hover:bg-danger-solid/90 shadow-soft disabled:bg-surface-3 disabled:text-text-muted disabled:shadow-none",
};

// Deprecated aliases kept so existing call sites keep rendering while they are
// migrated: outline -> secondary, success -> primary. Do not add new uses.
const aliases = {
  outline: "secondary",
  success: "primary",
};

// Square sizes for an icon-only affordance: equal width and height, no
// horizontal padding, and no gap (the base string drops `gap-2` for these).
// 24px is the WCAG 2.2 AA floor for a pointer target (SC 2.5.8), so `icon-sm`
// is the smallest square offered; `icon` matches the 32px controls that already
// sit in the dashboard toolbars.
const sizes = {
  sm: "h-7 px-3 text-xs rounded-[8px]",
  md: "h-9 px-4 text-sm rounded-[var(--radius-brand)]",
  lg: "h-11 px-6 text-sm rounded-[var(--radius-brand)]",
  icon: "size-8 rounded-[var(--radius-brand)]",
  "icon-sm": "size-6 rounded-[8px]",
};

const iconOnlySizes = new Set(["icon", "icon-sm"]);

// An icon carries no accessible name, so an icon-only Button without one renders
// as an unlabelled control. Surface it in development rather than shipping it.
function warnIfUnnamed(size, children, props) {
  if (process.env.NODE_ENV === "production" || !iconOnlySizes.has(size)) return;
  if (props["aria-label"] || props["aria-labelledby"] || props.title) return;
  const onlyIcon =
    !children ||
    (children.props &&
      (/material-symbols/.test(children.props.className || "") ||
        children.type === "svg"));
  if (onlyIcon) {
    console.warn(
      "Button: size=\"" +
        size +
        "\" renders an icon-only control, which needs an aria-label, an " +
        "aria-labelledby or a title. Rendered without an accessible name."
    );
  }
}

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
  const iconOnly = iconOnlySizes.has(size);
  warnIfUnnamed(size, children, props);
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
        "focus-ring inline-flex items-center justify-center font-semibold transition-colors duration-150 cursor-pointer",
        // `gap-2` is emitted after `gap-0`, so an icon size cannot cancel it
        // through a later class. It is left out instead of overridden.
        !iconOnly && "gap-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        // `bare` maps to the empty string, so key presence decides the
        // fallback rather than truthiness.
        resolved in variants ? variants[resolved] : variants.primary,
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
