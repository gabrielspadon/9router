"use client";

import { useState } from "react";
import { LOCALE_COOKIE, LOCALE_NAMES, normalizeLocale } from "@/i18n/config";
import LanguageSwitcher from "./LanguageSwitcher";
import Button from "@/shared/components/Button";

function getLocaleFromCookie() {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

export default function HeaderLanguage() {
  const [open, setOpen] = useState(false);
  const [locale, setLocale] = useState("en");
  // A flag is a country, not a language: en is not the United States and es is
  // not Spain. The control shows the language's own name instead.
  const name = LOCALE_NAMES[locale] || locale;

  const handleOpen = () => {
    setLocale(getLocaleFromCookie());
    setOpen(true);
  };

  return (
    <>
      <Button
        variant="ghost" size="sm"
        className="min-h-11 max-w-[11rem]"
        onClick={handleOpen}
        aria-label={`Language: ${name}`}
        aria-haspopup="dialog"
        data-i18n-skip="true"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
          language
        </span>
        <span className="hidden sm:inline truncate text-xs font-medium">{name}</span>
      </Button>

      <LanguageSwitcher
        hideTrigger
        isOpen={open}
        onClose={(next) => {
          setOpen(false);
          setLocale(next);
        }}
      />
    </>
  );
}
