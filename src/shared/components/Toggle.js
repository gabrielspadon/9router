"use client";

import { cn } from "@/shared/utils/cn";

// A switch with no visible label carries no accessible name unless the call
// site supplies one, and `role="switch"` with no name is what axe reports as
// `button-name`. Surface it in development rather than shipping it.
function warnIfUnnamed(name) {
  if (process.env.NODE_ENV === "production" || name) return;
  console.warn(
    "Toggle: renders a switch with no accessible name. Pass `ariaLabel`, " +
      "`label` or `title` saying what the switch turns on."
  );
}

export default function Toggle({
  checked = false,
  onChange,
  label,
  description,
  ariaLabel,
  title,
  disabled = false,
  size = "md",
  className,
}) {
  // `track` is the drawn switch. The 44px pointer target comes from `hit-44`,
  // which is a pseudo-element overlay and so costs no layout: the track keeps
  // its size and the row keeps its height, which is how a dense operational
  // layout meets the 44px pointer floor without growing.
  const sizes = {
    sm: { track: "w-8 h-4", thumb: "size-3", translate: "translate-x-4" },
    md: { track: "w-11 h-6", thumb: "size-5", translate: "translate-x-5" },
    lg: { track: "w-14 h-7", thumb: "size-6", translate: "translate-x-7" },
  };

  const name = ariaLabel || (typeof label === "string" ? label : undefined) || title;
  warnIfUnnamed(name);

  const handleClick = () => {
    if (!disabled && onChange) onChange(!checked);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={name}
        title={title}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          "focus-ring hit-44 relative inline-flex shrink-0 cursor-pointer items-center rounded-full",
          "transition-colors duration-150",
          checked ? "bg-brand-solid" : "bg-surface-3",
          sizes[size].track,
          disabled && "cursor-not-allowed"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block rounded-full bg-white",
            "transform transition-transform duration-150",
            checked ? sizes[size].translate : "translate-x-0.5",
            sizes[size].thumb
          )}
        />
      </button>
      {(label || description) && (
        <div className="flex flex-col">
          {label && (
            <span className="text-sm font-medium text-text-main">{label}</span>
          )}
          {description && (
            <span className="text-xs text-text-muted">{description}</span>
          )}
        </div>
      )}
    </div>
  );
}
