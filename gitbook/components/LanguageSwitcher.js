"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import { Globe, X } from "lucide-react";
import { LANGUAGES, getLanguage, DEFAULT_LANG } from "@/constants/languages";
import { t } from "@/constants/docsConfig";

function extractLangFromPath(pathname) {
  const match = pathname.match(/^\/([^/]+)(?:\/(.*))?$/);
  if (!match) return { lang: DEFAULT_LANG, rest: "" };
  return { lang: match[1], rest: match[2] || "" };
}

export default function LanguageSwitcher({ currentLang }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const current = getLanguage(currentLang);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  const switchTo = (code) => {
    const { rest } = extractLangFromPath(pathname);
    const target = rest ? `/${code}/${rest}` : `/${code}`;
    setOpen(false);
    router.push(target);
  };

  const modal = open && (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
      <div
        className="bg-surface border border-border rounded-[var(--radius-brand-lg)] shadow-elev max-w-md w-full max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-bold text-lg text-text-main">{t(currentLang, "selectLanguage")}</h2>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors duration-150"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>
        <div className="p-2 overflow-y-auto max-h-[60vh]">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => switchTo(lang.code)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-150 ${
                lang.code === currentLang
                  ? "bg-brand-soft text-brand font-medium"
                  : "text-text-main hover:bg-surface-2"
              }`}
            >
              <span className="text-2xl">{lang.flag}</span>
              <div className="flex-1">
                <div className="font-medium">{lang.native}</div>
                <div className="text-xs text-text-muted">{lang.name}</div>
              </div>
              {lang.code === currentLang && <span className="text-xs">✓</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-text-main bg-surface-2 rounded-lg hover:bg-surface-3 transition-colors duration-150"
        aria-label="Switch language"
      >
        <Globe className="w-4 h-4" />
        <span className="hidden sm:inline">{current.flag} {current.native}</span>
        <span className="sm:hidden">{current.flag}</span>
      </button>

      {open && createPortal(modal, document.body)}
    </>
  );
}
