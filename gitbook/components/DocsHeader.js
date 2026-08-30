"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { DOCS_CONFIG, t } from "@/constants/docsConfig";
import { DEFAULT_LANG } from "@/constants/languages";
import { ExternalLink, Menu, X } from "lucide-react";
import DocsSidebar from "./DocsSidebar";
import LanguageSwitcher from "./LanguageSwitcher";

export default function DocsHeader({ lang = DEFAULT_LANG }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // The drawer covers the page, so Escape has to dismiss it: the overlay
  // click is a pointer shortcut, not the only way out.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b bg-surface/80 backdrop-blur-sm border-border">
        <div className=" mx-auto px-4 h-16 flex items-center justify-between">
          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="lg:hidden p-2 rounded-brand hover:bg-surface-2 transition-colors duration-150"
            aria-label={t(lang, "openMenu")}
            aria-expanded={mobileMenuOpen}
          >
            <Menu className="w-6 h-6 text-text-muted" />
          </button>

          {/* Logo */}
          <Link href={`/${lang}`} className="flex items-center gap-2 font-bold text-2xl text-text-main hover:opacity-80 transition-opacity duration-150">
            <span>9</span>
            <span className="text-brand">{DOCS_CONFIG.logo} Docs</span>
          </Link>

          {/* Right side */}
          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageSwitcher currentLang={lang} />

            {/* Go to App */}
            <Link
              href={DOCS_CONFIG.appUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t(lang, "goToApp")}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-brand-solid text-brand-on rounded-brand font-medium hover:bg-brand-700 transition-colors duration-150 text-sm"
            >
              <span className="hidden sm:inline">{t(lang, "goToApp")}</span>
              <ExternalLink aria-hidden="true" className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <>
          <div
            className="mobile-menu-overlay lg:hidden"
            aria-hidden="true"
            onClick={() => setMobileMenuOpen(false)}
          />
          
          <div className="mobile-menu-drawer lg:hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <span className="font-bold text-lg text-text-main">
                <span className="text-brand">9</span>{DOCS_CONFIG.logo} Docs
              </span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded-brand hover:bg-surface-2 transition-colors duration-150"
                aria-label={t(lang, "closeMenu")}
              >
                <X className="w-5 h-5 text-text-muted" />
              </button>
            </div>
            <DocsSidebar isMobile onClose={() => setMobileMenuOpen(false)} lang={lang} />
          </div>
        </>
      )}
    </>
  );
}
