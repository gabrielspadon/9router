"use client";
import { useEffect, useState } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";

const CLI_TOOLS = [
  { id: "claude", name: "Claude Code", image: "/providers/claude.png" },
  { id: "codex", name: "OpenAI Codex", image: "/providers/codex.png" },
  { id: "cline", name: "Cline", image: "/providers/cline.png" },
  { id: "cursor", name: "Cursor", image: "/providers/cursor.png" },
];

const PROVIDERS = [
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Anthropic" },
  { id: "gemini", name: "Gemini" },
  { id: "github", name: "GitHub Copilot" },
];

export default function FlowAnimation() {
  const [activeFlow, setActiveFlow] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveFlow((prev) => (prev + 1) % PROVIDERS.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mt-16 w-full max-w-4xl relative h-[360px] hidden md:flex items-center justify-center">
      {/* TokenProxy Hub - Center */}
      <div className="relative z-20 w-32 h-32 rounded-full bg-surface border-2 border-brand-500 flex flex-col items-center justify-center gap-1 group">
        <span className="material-symbols-outlined text-4xl text-brand" aria-hidden="true">
          hub
        </span>
        <span className="font-display text-xs font-bold text-text-main tracking-widest">
          TokenProxy
        </span>
      </div>

      {/* CLI Tools - Left side. left-0/right-0 stay physical here: both columns
          anchor to hardcoded SVG path coordinates below, and the SVG is not
          mirrored in RTL. */}
      <div className="absolute left-0 top-1/2 -translate-y-1/2 flex flex-col gap-8">
        {CLI_TOOLS.map((tool) => (
          <div
            key={tool.id}
            className="flex items-center gap-3 opacity-70 hover:opacity-100 transition-opacity group"
          >
            <div className="w-16 h-16 rounded-2xl bg-surface border border-border flex items-center justify-center overflow-hidden p-2 hover:border-brand-500/50 transition-colors duration-150">
              <ProviderIcon
                src={tool.image}
                alt={tool.name}
                size={48}
                className="object-contain rounded-xl max-w-[48px] max-h-[48px]"
                fallbackText={tool.name.slice(0, 2).toUpperCase()}
              />
            </div>
          </div>
        ))}
      </div>

      {/* SVG Lines from CLI to TokenProxy */}
      <svg
        className="absolute inset-0 w-full h-full z-10 pointer-events-none stroke-text-subtle"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          className="animate-[dash_2s_linear_infinite]"
          d="M 60 50 C 250 70, 250 180, 360 180"
          fill="none"
          strokeDasharray="5,5"
          strokeWidth="2"
        ></path>
        <path
          className="animate-[dash_2s_linear_infinite]"
          d="M 60 140 C 250 140, 250 180, 360 180"
          fill="none"
          strokeDasharray="5,5"
          strokeWidth="2"
        ></path>
        <path
          className="animate-[dash_2s_linear_infinite]"
          d="M 60 210 C 250 210, 250 180, 360 180"
          fill="none"
          strokeDasharray="5,5"
          strokeWidth="2"
        ></path>
        <path
          className="animate-[dash_2s_linear_infinite]"
          d="M 60 300 C 250 280, 250 180, 360 180"
          fill="none"
          strokeDasharray="5,5"
          strokeWidth="2"
        ></path>
      </svg>

      {/* SVG Lines from TokenProxy to Providers */}
      <svg
        className="absolute inset-0 w-full h-full z-10 pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M 440 180 C 550 180, 550 50, 740 50"
          fill="none"
          stroke={activeFlow === 0 ? "var(--color-brand-500)" : "var(--color-text-subtle)"}
          strokeWidth={activeFlow === 0 ? "3" : "2"}
          className={activeFlow === 0 ? "animate-pulse" : ""}
        ></path>
        <path
          d="M 440 180 C 550 180, 550 130, 740 130"
          fill="none"
          stroke={activeFlow === 1 ? "var(--color-brand-500)" : "var(--color-text-subtle)"}
          strokeWidth={activeFlow === 1 ? "3" : "2"}
          className={activeFlow === 1 ? "animate-pulse" : ""}
        ></path>
        <path
          d="M 440 180 C 550 180, 550 230, 740 230"
          fill="none"
          stroke={activeFlow === 2 ? "var(--color-brand-500)" : "var(--color-text-subtle)"}
          strokeWidth={activeFlow === 2 ? "3" : "2"}
          className={activeFlow === 2 ? "animate-pulse" : ""}
        ></path>
        <path
          d="M 440 180 C 550 180, 550 310, 740 310"
          fill="none"
          stroke={activeFlow === 3 ? "var(--color-brand-500)" : "var(--color-text-subtle)"}
          strokeWidth={activeFlow === 3 ? "3" : "2"}
          className={activeFlow === 3 ? "animate-pulse" : ""}
        ></path>
      </svg>

      {/* AI Providers - Right side */}
      <div className="absolute right-0 top-0 bottom-0 flex flex-col justify-between py-5.5">
        {PROVIDERS.map((provider, idx) => (
          <div
            key={provider.id}
            className={`px-4 py-2 rounded-lg bg-surface border flex items-center gap-1.5 justify-center font-bold text-xs transition-colors duration-150 min-w-[140px] ${
              activeFlow === idx
                ? "border-brand-500 text-brand"
                : "border-border text-text-main"
            }`}
          >
            <span
              className={`material-symbols-outlined text-[14px] ${
                activeFlow === idx ? "opacity-100" : "opacity-0"
              }`}
              aria-hidden="true"
            >
              bolt
            </span>
            {provider.name}
          </div>
        ))}
      </div>

      {/* Mobile fallback */}
      <div className="md:hidden mt-8 w-full p-4 rounded-lg bg-surface border border-border">
        <p className="text-sm text-center text-text-muted">
          Interactive diagram visible on desktop
        </p>
      </div>
    </div>
  );
}
