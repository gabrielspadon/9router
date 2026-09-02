"use client";

import { cn } from "@/shared/utils/cn";

// Status is never carried by hue alone. Every status pairs a colour with a
// glyph and a word, so it survives colour blindness, a monochrome print and a
// screenshot pasted into a ticket.
//
// The glyphs are deliberately distinguishable by shape rather than by fill:
// a filled disc, a hollow ring, a triangle, a square. Every tone therefore
// needs its OWN shape. `degraded` and `failing` both carried "▲", which is
// exactly the collision this rule exists to prevent, and it only became
// visible once the provider health matrix put the two side by side in one
// column. `failing` takes the inverted triangle: distinct in outline, and it
// reads as the more severe of the pair without depending on its colour.
const tones = {
  ok: { cls: "text-success border-success/40", glyph: "●" },
  degraded: { cls: "text-warning border-warning/40", glyph: "▲" },
  failing: { cls: "text-danger border-danger/40", glyph: "▼" },
  idle: { cls: "text-text-subtle border-border", glyph: "○" },
  active: { cls: "text-brand border-brand-line", glyph: "■" },
  info: { cls: "text-info border-info/40", glyph: "◆" },
};

export default function StatusToken({
  tone = "idle",
  children,
  glyph,
  className,
  ...props
}) {
  const t = tones[tone] || tones.idle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-1.5 py-1",
        // The glyph must not part from its word, but the word itself is
        // translated and a German or Vietnamese status is longer than an
        // English one. `whitespace-nowrap` on the whole token forced that
        // longer string onto one line; `text-balance` keeps the token compact
        // without forbidding the wrap the design system requires for a
        // translated label.
        "font-mono text-[10.5px] leading-4 rounded-[2px] text-balance",
        t.cls,
        className,
      )}
      {...props}
    >
      <span aria-hidden="true">{glyph ?? t.glyph}</span>
      <span>{children}</span>
    </span>
  );
}
