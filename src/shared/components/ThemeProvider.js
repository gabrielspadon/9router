"use client";

import { useEffect } from "react";
import useThemeStore from "@/store/themeStore";

export function ThemeProvider({ children }) {
  const { initTheme } = useThemeStore();

  // First paint is already correct: layout.js runs a blocking script that applies
  // .dark from the same persisted value. This reconciles the store on mount.
  useEffect(() => {
    initTheme();
  }, [initTheme]);

  return <>{children}</>;
}

