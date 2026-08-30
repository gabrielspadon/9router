"use client";

import { useState, useEffect } from "react";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { LOCALE_FLAGS } from "@/shared/constants/locales";
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

  useEffect(() => {
    setLocale(getLocaleFromCookie());
  }, [open]);

  return (
    <>
      <Button
        variant="ghost" size="icon"
        onClick={() => setOpen(true)}
        title="Language"
        data-i18n-skip="true"
      >
        <span className="text-lg leading-none">{LOCALE_FLAGS[locale] || "🌐"}</span>
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
