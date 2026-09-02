"use client";

import { cn } from "@/shared/utils/cn";

// A table is structure, not a card. Rules separate rows, the header is a mono
// eyebrow, and numeric columns are tabular so a column of figures aligns and a
// changing readout does not jitter.
//
// Wide tables scroll inside their own container so the page body never scrolls
// sideways.
// The design system names the two densities by ROW HEIGHT, 30 to 34 pixels for
// observation and 40 to 44 for configuration, so the height is stated here
// rather than left to whatever padding plus the current line-height happens to
// add up to. `height` on a `tr` acts as a minimum in table layout, so a row
// whose content is taller still grows; the padding keeps the text off the rule.
const densities = {
  observation: "[&_tr]:h-8 [&_td]:py-1.5 [&_th]:pb-1.5 text-[12.5px]",
  configuration: "[&_tr]:h-11 [&_td]:py-3 [&_th]:pb-3 text-sm",
};

// A table with no name reads to a screen reader as "table, 5 rows" and nothing
// else, and its scroll container is a region a keyboard cannot reach. `label`
// answers both, so it is required rather than optional.
function warnIfUnnamed(label) {
  if (process.env.NODE_ENV === "production" || label) return;
  console.warn(
    "Table: rendered with no `label`. Pass one saying what the rows are, " +
      "so the table has an accessible name and its scroll region has a title."
  );
}

export function Table({ label, density = "observation", className, children, ...props }) {
  warnIfUnnamed(label);
  return (
    // The scroller is focusable so a keyboard can scroll a wide table
    // sideways; `role="region"` plus the name is what makes that tab stop
    // announce itself rather than arriving as an anonymous one.
    <div
      className="w-full overflow-x-auto scroll-thin-x"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table
        aria-label={label}
        className={cn(
          "w-full border-collapse text-start",
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
        "border-b border-border pe-3 font-mono text-[10px] font-normal uppercase",
        "tracking-[0.12em] text-text-muted",
        // Physical `text-right` on purpose, do not convert to `text-end`.
        // Numerals are an LTR run in every locale, so the least-significant
        // digit sits on the right; keeping it physical keeps a column of
        // numbers decimal-aligned in RTL as well as LTR.
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
        "border-b border-border-subtle pe-3 align-middle text-text-main",
        (numeric || mono) && "font-mono",
        // Physical, same reason as TH above: numeric columns do not mirror.
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
