"use client";

export default function Tooltip({ text, children, position = "top", color }) {
  // left-1/2 stays physical: it is paired with -translate-x-1/2, and transforms
  // are not direction-aware, so start-1/2 would break the centering.
  const posClass = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
    left: "end-full top-1/2 -translate-y-1/2 me-1.5",
    right: "start-full top-1/2 -translate-y-1/2 ms-1.5",
  }[position];

  const bgStyle = color ? { backgroundColor: color } : {};
  const bgClass = color ? "" : "bg-surface border border-border shadow-elev";
  const fgClass = color ? "text-white" : "text-text-main";

  return (
    <div className="relative inline-flex group/tt">
      {children}
      <div
        className={`pointer-events-none absolute ${posClass} z-50 w-max max-w-56 rounded px-2 py-1 text-xs leading-snug ${bgClass} ${fgClass} opacity-0 group-hover/tt:opacity-100 transition-opacity duration-150 whitespace-normal`}
        style={bgStyle}
      >
        {text}
      </div>
    </div>
  );
}
