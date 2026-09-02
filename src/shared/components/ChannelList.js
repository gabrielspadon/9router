"use client";

import { cn } from "@/shared/utils/cn";

// The patch bay. A combo's fallback order is a sequence, so it is drawn as a
// numbered sequence rather than described in prose: channel 1 is tried first,
// channel 2 second. The number is the position, and it is the control's stable
// address when someone reports a problem.
//
// Purely presentational. Reordering, enabling and testing stay with the page
// that owns that behaviour; this renders what it is given.
export function ChannelList({ className, children, ...props }) {
  return (
    <div
      className={cn("border border-border bg-surface", className)}
      {...props}
    >
      {children}
    </div>
  );
}

// The flow strip, direction.md's graft from A2 Route Atlas: "explaining the
// chain is the whole job". A patch bay states the ORDER of the channels but not
// what happens at the junction, and critique.md item 6 is that nothing in the
// interface draws a request entering, choosing a channel, and leaving. This is
// that sentence, drawn as a sequence rather than written as prose: a request
// arrives, the junction rule decides, one of N channels answers.
//
// It is deliberately not a diagram. A canvas would be decoration here; the
// chain has three steps and they fit on one line in the technical face.
export function FlowStrip({ junction, channels, className, ...props }) {
  const steps = [
    { key: "in", text: "request" },
    { key: "junction", text: junction, mark: true },
    { key: "out", text: `${channels} ${channels === 1 ? "channel" : "channels"}` },
  ];
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[10.5px] text-text-muted",
        className,
      )}
      {...props}
    >
      {steps.map((step, i) => (
        <span key={step.key} className="flex items-center gap-1.5">
          {i > 0 ? (
            <span aria-hidden="true" className="text-text-subtle">
              &rsaquo;
            </span>
          ) : null}
          <span className={step.mark ? "text-text-main" : undefined}>{step.text}</span>
        </span>
      ))}
    </p>
  );
}

const states = {
  live: {
    row: "",
    no: "bg-brand-solid text-brand-on border-brand-solid",
  },
  failing: {
    row: "bg-danger-soft",
    no: "border-danger text-danger",
  },
  standby: { row: "", no: "border-border text-text-muted" },
  idle: { row: "", no: "border-border-subtle text-text-subtle" },
};

export function Channel({
  index,
  title,
  subtitle,
  state = "idle",
  status,
  metrics,
  actions,
  className,
  ...props
}) {
  const s = states[state] || states.idle;
  return (
    <div
      className={cn(
        "grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3",
        "border-b border-border-subtle last:border-b-0",
        s.row,
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex h-[22px] items-center justify-center border font-mono text-[11px] tabular-nums",
          s.no,
        )}
      >
        {index}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-mono text-[12.5px] text-text-main">
          <span className="sr-only">Channel {index}. </span>
          {title}
        </span>
        {subtitle ? (
          <span className="block truncate font-mono text-[10.5px] text-text-muted">
            {subtitle}
          </span>
        ) : null}
        {metrics ? (
          <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{metrics}</span>
        ) : null}
      </span>
      <span className="flex items-center gap-2">
        {status}
        {actions}
      </span>
    </div>
  );
}

export default ChannelList;
