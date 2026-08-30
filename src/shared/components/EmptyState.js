"use client";

import { cn } from "@/shared/utils/cn";

// An empty region states what would be here, why it is not, and the one action
// that changes it. It is a bordered field rather than a card, because nothing
// portable lives here yet.
export default function EmptyState({
  icon,
  title,
  description,
  action,
  density = "comfortable",
  className,
  ...props
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center border border-dashed border-border",
        "bg-bg-alt text-center rounded-[var(--radius-brand)]",
        density === "compact" ? "gap-2 px-4 py-6" : "gap-3 px-6 py-12",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className="text-text-subtle">
          {icon}
        </span>
      ) : null}
      {title ? (
        <p className="text-sm font-medium text-text-main">{title}</p>
      ) : null}
      {description ? (
        <p className="max-w-prose text-xs text-text-muted">{description}</p>
      ) : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
