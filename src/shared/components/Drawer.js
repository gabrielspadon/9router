"use client";

import { useEffect } from "react";
import { cn } from "@/shared/utils/cn";
import Button from "@/shared/components/Button";

export default function Drawer({
  isOpen,
  onClose,
  title,
  children,
  width = "md",
  className
}) {
  const widths = {
    sm: "w-[400px]",
    md: "w-[500px]",
    lg: "w-[600px]",
    xl: "w-[800px]",
    full: "w-full",
  };

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px] fade-in cursor-pointer"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel. Pinned to the inline end, so it sits on the right in a
          left-to-right locale and on the left in a right-to-left one, and its
          border falls on the edge facing the page. The entry animation follows:
          globals.css swaps `.slide-in-right` to a keyframe that enters from the
          other side under `[dir="rtl"]`, because a percentage translate cannot
          read the writing direction on its own. */}
      <div className={cn(
        "absolute end-0 top-0 h-full bg-surface flex flex-col",
        "shadow-[var(--shadow-elev)]",
        "slide-in-right",
        "border-s border-border-subtle",
        widths[width] || widths.md,
        className
      )}>
        {/* Header */}
        <div className="flex items-center justify-between p-5.5 border-b border-border-subtle flex-shrink-0">
          <div className="flex items-center gap-3">
            {title && (
              <h2 className="text-lg font-semibold text-text-main">{title}</h2>
            )}
          </div>
          <Button
            variant="ghost" size="icon"
            type="button"
            onClick={onClose}
            aria-label="Close"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5.5 custom-scrollbar">
          {children}
        </div>
      </div>
    </div>
  );
}
