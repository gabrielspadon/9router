"use client";

import { cn } from "@/shared/utils/cn";

// Closed variant set. Brand carries primary action, danger carries destruction,
// and nothing else is coloured; `bare` colours nothing at all. See
// docs/design/design-system.md section 1.
const variants = {
  primary:
    "bg-brand-solid text-brand-on hover:bg-brand-solid-hover disabled:bg-surface-3 disabled:text-text-muted disabled:shadow-none",
  secondary:
    "bg-surface-2 text-text-main border border-border hover:bg-surface-3 disabled:opacity-50",
  ghost: "text-text-muted hover:bg-surface-2 hover:text-text-main",
  // No colour opinion at all: the call site owns text and hover colour. Needed
  // because `cn` has no conflict resolution, so a className colour override on a
  // coloured variant silently loses to whichever class Tailwind emitted later
  // last. Icon-only affordances that hover to
  // danger or brand use this; everything with a stock colour uses `ghost`.
  bare: "",
  danger:
    "bg-danger-solid text-danger-on hover:bg-danger-solid-hover disabled:bg-surface-3 disabled:text-text-muted disabled:shadow-none",
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
// Heights are minimums, not fixed. A fixed `h-` clipped a label that wrapped:
// at 200 percent zoom, or in a locale whose translation runs longer than the
// English, a two- or three-line label overflowed the pill. The button grows
// instead, and at its resting one-line size it measures exactly as before.
const sizes = {
  sm: "min-h-7 px-3 py-1 text-xs rounded-[var(--radius-brand)]",
  md: "min-h-9 px-4 py-1.5 text-sm rounded-[var(--radius-brand)]",
  lg: "min-h-11 px-5.5 py-2 text-sm rounded-[var(--radius-brand)]",
  icon: "size-8 rounded-[var(--radius-brand)]",
  "icon-sm": "size-6 rounded-[var(--radius-brand)]",
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
        // `hit-44` is a transparent pseudo-element overlay: every size below
        // renders a target of at least 44x44 while the pill itself keeps the
        // height its density asks for. It costs no layout, so a toolbar row
        // does not grow: the 44px pointer floor is met by hit area, not by size.
        "focus-ring hit-44 inline-flex items-center justify-center font-semibold transition-colors duration-150 cursor-pointer",
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
