"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, normalizeLocale } from "@/i18n/config";
import { reloadTranslations } from "@/i18n/runtime";
import Button from "@/shared/components/Button";

function getLocaleFromCookie() {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

export default function LanguageSwitcher({ className = "", isOpen: controlledOpen, onClose, hideTrigger = false }) {
  const [locale, setLocale] = useState("en");
  const [isPending, setIsPending] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const modalRef = useRef(null);

  const isControlled = typeof controlledOpen === "boolean";
  const isOpen = isControlled ? controlledOpen : internalOpen;
  const setIsOpen = (value, nextLocale = locale) => {
    if (isControlled) {
      if (!value && onClose) onClose(nextLocale);
    } else {
      setInternalOpen(value);
    }
  };

  useEffect(() => {
    setLocale(getLocaleFromCookie());
  }, []);

  // Close modal when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const handleSetLocale = async (nextLocale) => {
    if (nextLocale === locale || isPending) return;

    setIsPending(true);
    try {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      });
      
      // Reload translations without full page reload
      await reloadTranslations();
      setLocale(nextLocale);
      setIsOpen(false, nextLocale);
    } catch (err) {
      console.error("Failed to set locale:", err);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className={className}>
      {/* Trigger button */}
      {!hideTrigger && (
        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={isPending}
          className="flex min-h-11 items-center gap-2 px-3 py-2 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors"
          aria-label={`Language: ${LOCALE_NAMES[locale] || locale}`}
          aria-haspopup="dialog"
          data-i18n-skip="true"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[20px]">language</span>
          <span className="text-sm font-medium">{LOCALE_NAMES[locale] || locale}</span>
        </button>
      )}

      {/* Portal modal - renders at document.body to avoid parent layout constraints */}
      {isOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-i18n-skip="true">
          {/* Overlay */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          />

          {/* Modal content */}
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="language-switcher-title"
            className="relative w-full bg-surface border border-border rounded-[var(--radius-brand-lg)] shadow-elev fade-in max-w-2xl flex flex-col max-h-[80vh]"
          >
            {/* Modal header */}
            <div className="flex items-center justify-between p-3 border-b border-border-subtle">
              <h2 id="language-switcher-title" className="text-lg font-semibold text-text-main">
                Select Language
              </h2>
              <Button
                variant="ghost" size="icon"
                className="min-h-11 min-w-11"
                onClick={() => setIsOpen(false)}
                aria-label="Close"
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">close</span>
              </Button>
            </div>

            {/* Modal body - fixed grid columns, equal sizing */}
            <div className="p-5.5 overflow-y-auto flex-1">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
                {LOCALES.map((item) => {
                  const active = locale === item;
                  const name = LOCALE_NAMES[item] || item;
                  return (
                    <button
                      key={item}
                      onClick={() => handleSetLocale(item)}
                      disabled={isPending}
                      aria-current={active ? "true" : undefined}
                      className={`flex min-h-11 flex-col items-center justify-center gap-1 px-2 py-3 rounded-lg text-xs font-medium transition-colors w-full ${
                        active
                          ? "bg-brand-soft text-brand ring-2 ring-brand-solid"
                          : "text-text-main hover:bg-surface-2"
                      } ${isPending ? "opacity-70 cursor-wait" : ""}`}
                      lang={item}
                    >
                      {/* Fixed 2-line height so all cards are uniform */}
                      <span className="text-center leading-tight line-clamp-2 h-8 flex items-center">{name}</span>
                      {active && (
                        <span aria-hidden="true" className="material-symbols-outlined text-sm">check</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
