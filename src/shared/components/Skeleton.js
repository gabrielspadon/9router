"use client";

import { cn } from "@/shared/utils/cn";

// A loading placeholder that occupies the shape of the thing it is standing in
// for. Animation is opt-out under prefers-reduced-motion, handled in globals.css
// by neutralising motion-safe utilities.
//
// Intent is expressed through props, never through a caller className: `cn` is
// a plain join with no conflict resolution, so a caller-supplied colour would
// land in an undefined order against the variant's own.
const shapes = {
  line: "h-3 rounded-[2px]",
  text: "h-4 rounded-[2px]",
  heading: "h-6 rounded-[2px]",
  block: "h-24 rounded-[3px]",
  cell: "h-4 rounded-[2px]",
  circle: "rounded-full",
};

export default function Skeleton({
  shape = "line",
  width,
  height,
  count = 1,
  className,
  ...props
}) {
  const items = Array.from({ length: Math.max(1, count) });
  return (
    <span className={cn("block", count > 1 && "space-y-2", className)} {...props}>
      {items.map((_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn(
            "block bg-surface-2 motion-safe:animate-pulse",
            shapes[shape] || shapes.line,
          )}
          style={{
            width: width ?? (count > 1 && i === items.length - 1 ? "62%" : "100%"),
            height,
          }}
        />
      ))}
    </span>
  );
}
