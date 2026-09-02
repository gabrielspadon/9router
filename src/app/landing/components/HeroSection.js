"use client";

export default function HeroSection() {
  return (
    <section className="relative pt-32 pb-20 px-5.5 min-h-[90vh] flex flex-col items-center justify-center overflow-hidden">
      {/* Glow effect. `left-1/2 -translate-x-1/2` is the centering idiom, not a
          direction: the two halves cancel in either writing direction. */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-brand-500/10 rounded-full blur-[120px] pointer-events-none"></div>
      
      <div className="relative z-10 max-w-4xl w-full text-center flex flex-col items-center gap-8">
        {/* Version badge */}
        <div className="inline-flex items-center gap-2 rounded-full border border-brand-line bg-brand-soft px-3 py-1 text-xs font-medium text-brand">
          <span className="flex h-2 w-2 rounded-full bg-brand-500 animate-pulse" aria-hidden="true"></span>
          v1.0 is now live
        </div>

        {/* Main heading */}
        <h1 className="text-5xl md:text-7xl font-black leading-[1.1] tracking-tight">
          One Endpoint for <br/>
          <span className="text-brand">All AI Providers</span>
        </h1>

        {/* Description */}
        <p className="text-lg md:text-xl text-text-muted max-w-2xl mx-auto font-light">
          AI endpoint proxy with web dashboard - A JavaScript port of CLIProxyAPI. Works seamlessly with Claude Code, OpenAI Codex, Cline, RooCode, and other CLI tools.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-4 w-full">
          <button
            type="button"
            className="focus-ring h-12 px-8 rounded-lg bg-brand-solid hover:bg-brand-solid-hover text-brand-on text-base font-bold transition-colors duration-150 flex items-center gap-2"
          >
            <span className="material-symbols-outlined" aria-hidden="true">rocket_launch</span>
            Get Started
          </button>
          <a
            href="/dashboard/skills"
            className="focus-ring h-12 px-8 rounded-lg border border-border bg-surface hover:bg-surface-2 text-text-main text-base font-bold transition-colors duration-150 flex items-center gap-2"
          >
            <span className="material-symbols-outlined" aria-hidden="true">code</span>
            Agent Skills
          </a>
        </div>
      </div>
    </section>
  );
}

