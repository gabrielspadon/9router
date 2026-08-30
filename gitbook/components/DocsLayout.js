"use client";

import { useEffect } from "react";
import DocsHeader from "./DocsHeader";
import DocsSidebar from "./DocsSidebar";
import DocsToc from "./DocsToc";
import { DEFAULT_LANG } from "@/constants/languages";

export default function DocsLayout({ children, headings = [], lang = DEFAULT_LANG }) {
  // The <html> element lives in the root layout, which sits above the [lang]
  // segment and so cannot see the locale: every page is served lang="en".
  // A screen reader reads the live DOM, so correcting it here gives assistive
  // technology the right pronunciation for all five locales without moving
  // the document shell into the dynamic segment.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <DocsHeader lang={lang} />
      <div className="flex-1 flex">
        <div className="hidden lg:block">
          <DocsSidebar lang={lang} />
        </div>
        <div className="flex-1 flex min-w-0">
          {children}
          <div className="hidden lg:block">
            <DocsToc headings={headings} lang={lang} />
          </div>
        </div>
      </div>
    </div>
  );
}
