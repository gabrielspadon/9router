"use client";

import { cn } from "@/shared/utils/cn";

// A failure states what failed, the upstream detail if there is one, and the
// recovery action. The danger colour is paired with a glyph and the word, so the
// state survives colour blindness and a monochrome screenshot.
export default function ErrorState({
  title,
  description,
  detail,
  action,
  tone = "block",
  className,
  ...props
}) {
  const inline = tone === "inline";
  return (
    <div
      role="alert"
      className={cn(
        "border-s-2 border-danger bg-danger-soft",
        inline ? "px-3 py-2" : "px-4 py-3",
        className,
      )}
      {...props}
    >
      <p className={cn("flex items-center gap-2 font-medium text-danger", inline ? "text-xs" : "text-sm")}>
        <span aria-hidden="true">▲</span>
        <span>{title}</span>
      </p>
      {description ? (
        <p className="mt-1 text-xs text-text-muted">{description}</p>
      ) : null}
      {detail ? (
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-danger break-all">
          {detail}
        </p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
