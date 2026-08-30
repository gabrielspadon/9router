"use client";

export default function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      {/* Grid pattern */}
      <div className="landing-grid absolute inset-0" />

      {/* Brand glow */}
      <div className="absolute -top-20 left-1/4 w-[600px] h-[600px] bg-brand-500/20 rounded-full blur-[120px]" />

      {/* Vignette effect */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(circle at center, transparent 0%, color-mix(in srgb, var(--color-bg) 40%, transparent) 100%)'
        }}
      />
    </div>
  );
}

