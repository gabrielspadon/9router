"use client";

import PropTypes from "prop-types";
import StatusToken from "@/shared/components/StatusToken";

// One provider card's health, as words. Every condition present gets its own
// token carrying a count and a name, so a card holding four accounts in four
// different states says so instead of averaging them into one green badge.
//
// StatusToken pairs each tone with a glyph and a word, which is why the states
// survive a colour-blind reader, a monochrome print and a screenshot in a
// ticket. Nothing here is carried by hue.
export default function ProviderStatusTokens({ summary }) {
  const states = summary?.states || [];
  if (states.length === 0) {
    return <span className="text-text-muted">No connections</span>;
  }

  // States arrive worst-first, so the first action is the one that matters most.
  const action = states.find((s) => s.action)?.action || null;

  return (
    <>
      {states.map((s) => (
        <StatusToken key={s.state} tone={s.tone}>
          {`${s.count} ${s.label}`}
          {s.detail ? ` · ${s.detail}` : ""}
        </StatusToken>
      ))}
      {action && (
        <span className="basis-full text-text-muted">{action}</span>
      )}
    </>
  );
}

ProviderStatusTokens.propTypes = {
  summary: PropTypes.shape({
    states: PropTypes.arrayOf(
      PropTypes.shape({
        state: PropTypes.string.isRequired,
        tone: PropTypes.string.isRequired,
        label: PropTypes.string.isRequired,
        detail: PropTypes.string,
        action: PropTypes.string,
        count: PropTypes.number.isRequired,
      }),
    ),
  }),
};
