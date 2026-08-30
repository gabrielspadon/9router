'use client';

import { CAPACITY_META } from '@/shared/constants/models';
import Tooltip from './Tooltip';

// Render small icon badges for a model's capabilities (only those set true).
// The capability is carried by the glyph and by the tooltip label, so the badge
// renders in the muted text token rather than a per-capability hue; colour here
// is decoration, and hue is reserved for status. CAPACITY_META still carries a
// `color` field for callers that predate this, and colorOverride still wins.
// size: icon font-size in px (default 16).
export default function CapacityBadges({ caps, className = '', colorOverride, size = 16 }) {
  if (!caps) return null;
  const active = Object.keys(CAPACITY_META).filter((k) => caps[k]);
  if (active.length === 0) return null;

  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      {active.map((k) => (
        <Tooltip key={k} text={`${CAPACITY_META[k].label} — ${CAPACITY_META[k].desc}`}>
          <span
            className={`material-symbols-outlined leading-none cursor-help ${colorOverride || 'text-text-muted'}`}
            style={{ fontSize: `${size}px` }}
          >
            {CAPACITY_META[k].icon}
          </span>
        </Tooltip>
      ))}
    </span>
  );
}
