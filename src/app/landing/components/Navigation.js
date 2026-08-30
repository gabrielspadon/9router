"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const router = useRouter();

  return (
    <nav className="fixed top-0 z-50 w-full bg-bg/80 backdrop-blur-md border-b border-border">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <button
          type="button"
          className="focus-ring rounded-[10px] flex items-center gap-3 cursor-pointer bg-transparent border-none p-0"
          onClick={() => router.push("/")}
          aria-label="Navigate to home"
        >
          <div className="size-8 rounded bg-brand-solid flex items-center justify-center text-brand-on">
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">hub</span>
          </div>
          <h2 className="text-text-main text-xl font-bold tracking-tight">9Router</h2>
        </button>

        {/* Desktop menu */}
        <div className="hidden md:flex items-center gap-8">
          <a className="focus-ring rounded text-text-muted hover:text-text-main text-sm font-medium transition-colors duration-150" href="#features">Features</a>
          <a className="focus-ring rounded text-text-muted hover:text-text-main text-sm font-medium transition-colors duration-150" href="#how-it-works">How it Works</a>
          <a className="focus-ring rounded text-text-muted hover:text-text-main text-sm font-medium transition-colors duration-150" href="https://github.com/decolua/9router#readme" target="_blank" rel="noopener noreferrer">Docs</a>
          <a className="focus-ring rounded text-text-muted hover:text-text-main text-sm font-medium transition-colors duration-150 flex items-center gap-1" href="https://github.com/decolua/9router" target="_blank" rel="noopener noreferrer">
            GitHub <span className="material-symbols-outlined text-[14px]" aria-hidden="true">open_in_new</span>
          </a>
        </div>

        {/* CTA + Mobile menu */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="focus-ring hidden sm:flex h-9 items-center justify-center rounded-lg px-4 bg-brand-solid hover:bg-brand-700 transition-colors duration-150 text-brand-on text-sm font-bold"
          >
            Get Started
          </button>
          <button
            type="button"
            className="focus-ring rounded md:hidden text-text-main"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <span className="material-symbols-outlined" aria-hidden="true">{mobileMenuOpen ? "close" : "menu"}</span>
          </button>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border bg-bg/95 backdrop-blur-md">
          <div className="flex flex-col gap-4 p-6">
            <a className="focus-ring rounded text-text-muted hover:text-text-main text-sm font-medium transition-colors duration-150" href="#features" onClick={() => setMobileMenuOpen(false)}>Features</a>
            <a className="focus-ring rounded text-text-muted hover:text-text-main text-sm font-medium transition-colors duration-150" href="#how-it-works" onClick={() => setMobileMenuOpen(false)}>How it Works</a>
            <a className="focus-ring rounded text-text-muted hover:text-text-main text-sm font-medium transition-colors duration-150" href="https://github.com/decolua/9router#readme" target="_blank" rel="noopener noreferrer">Docs</a>
            <a className="focus-ring rounded text-text-muted hover:text-text-main text-sm font-medium transition-colors duration-150" href="https://github.com/decolua/9router" target="_blank" rel="noopener noreferrer">GitHub</a>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="focus-ring h-9 rounded-lg bg-brand-solid hover:bg-brand-700 text-brand-on text-sm font-bold transition-colors duration-150"
            >
              Get Started
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}

