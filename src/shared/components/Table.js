"use client";

import { cn } from "@/shared/utils/cn";

// A table is structure, not a card. Rules separate rows, the header is a mono
// eyebrow, and numeric columns are tabular so a column of figures aligns and a
// changing readout does not jitter.
//
// Wide tables scroll inside their own container so the page body never scrolls
// sideways.
const densities = {
  observation: "[&_td]:py-1.5 [&_th]:pb-1.5 text-[12.5px]",
  configuration: "[&_td]:py-2.5 [&_th]:pb-2.5 text-sm",
};

export function Table({ density = "observation", className, children, ...props }) {
  return (
    <div className="w-full overflow-x-auto scroll-thin-x">
      <table
        className={cn(
          "w-full border-collapse text-left",
          densities[density] || densities.observation,
          className,
        )}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

export function THead({ className, children, ...props }) {
  return (
    <thead className={cn("", className)} {...props}>
      {children}
    </thead>
  );
}

export function TH({ numeric = false, className, children, ...props }) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-border pr-3 font-mono text-[10px] font-normal uppercase",
        "tracking-[0.12em] text-text-muted",
        numeric && "text-right",
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function TBody({ className, children, ...props }) {
  return (
    <tbody className={cn("", className)} {...props}>
      {children}
    </tbody>
  );
}

// `tone` marks a row that needs attention. It sets a field colour AND is always
// accompanied by a status token in the row, so the row never signals by hue
// alone.
const rowTones = {
  default: "",
  danger: "bg-danger-soft",
  warning: "bg-warning-soft",
};

export function TR({ tone = "default", className, children, ...props }) {
  return (
    <tr className={cn(rowTones[tone] || "", className)} {...props}>
      {children}
    </tr>
  );
}

export function TD({ numeric = false, mono = false, className, children, ...props }) {
  return (
    <td
      className={cn(
        "border-b border-border-subtle pr-3 align-middle text-text-main",
        (numeric || mono) && "font-mono",
        numeric && "text-right tabular-nums",
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}

export default Table;
