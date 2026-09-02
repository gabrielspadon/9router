"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const router = useRouter();

  return (
    <nav className="fixed top-0 z-50 w-full bg-bg/80 backdrop-blur-md border-b border-border">
      <div className="max-w-7xl mx-auto px-5.5 h-16 flex items-center justify-between">
        {/* Logo */}
        <button
          type="button"
          className="focus-ring hit-44 rounded-[var(--radius-brand)] flex items-center gap-3 cursor-pointer bg-transparent border-none p-0"
          onClick={() => router.push("/")}
          aria-label="Navigate to home"
        >
          <div className="size-8 rounded bg-brand-solid flex items-center justify-center text-brand-on">
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">hub</span>
          </div>
          <h2 className="text-text-main text-xl font-bold tracking-tight">TokenProxy</h2>
        </button>

        {/* Desktop menu */}
        <div className="hidden md:flex items-center gap-8">
          <a className="focus-ring hit-44 rounded text-text-muted hover:text-text-main text-sm font-medium transition-colors duration-150" href="#features">Features</a>
          <a className="focus-ring hit-44 rounded text-text-muted hover:text-text-main text-sm font-medium transition-colors duration-150" href="#how-it-works">How it Works</a>
          <a className="focus-ring hit-44 rounded text-text-muted hover:text-text-main text-sm font-medium transition-colors duration-150" href="/dashboard/skills">Agent Skills</a>
        </div>

        {/* CTA + Mobile menu */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="focus-ring hidden sm:flex h-9 items-center justify-center rounded-lg px-4 bg-brand-solid hover:bg-brand-solid-hover transition-colors duration-150 text-brand-on text-sm font-bold"
          >
            Get Started
          </button>
          <button
            type="button"
            className="focus-ring hit-44 rounded md:hidden text-text-main"
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
          <div className="flex flex-col gap-4 p-5.5">
            <a className="focus-ring hit-44 rounded text-text-muted hover:text-text-main text-sm font-medium transition-colors duration-150" href="#features" onClick={() => setMobileMenuOpen(false)}>Features</a>
            <a className="focus-ring hit-44 rounded text-text-muted hover:text-text-main text-sm font-medium transition-colors duration-150" href="#how-it-works" onClick={() => setMobileMenuOpen(false)}>How it Works</a>
            <a className="focus-ring hit-44 rounded text-text-muted hover:text-text-main text-sm font-medium transition-colors duration-150" href="/dashboard/skills" onClick={() => setMobileMenuOpen(false)}>Agent Skills</a>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="focus-ring h-9 rounded-lg bg-brand-solid hover:bg-brand-solid-hover text-brand-on text-sm font-bold transition-colors duration-150"
            >
              Get Started
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}

