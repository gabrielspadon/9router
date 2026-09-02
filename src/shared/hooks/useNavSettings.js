"use client";

import { useEffect, useState } from "react";

// Minimal mode lives in settings.hiddenNavItems, and two things now read it:
// the rail and the phone job bar. One copy of the fetch, so the bar cannot
// disagree with the rail about which destinations exist.
export function useNavSettings() {
  const [hiddenNav, setHiddenNav] = useState(() => new Set());
  const [enableTranslator, setEnableTranslator] = useState(false);

  useEffect(() => {
    const load = () =>
      fetch("/api/settings")
        .then((res) => res.json())
        .then((data) => {
          if (data.enableTranslator) setEnableTranslator(true);
          if (Array.isArray(data.hiddenNavItems)) setHiddenNav(new Set(data.hiddenNavItems));
        })
        .catch(() => {});
    load();
    // Settings dispatches this after hiddenNavItems is edited, so the rail and
    // the bar both update without a reload.
    window.addEventListener("hidden-nav-changed", load);
    return () => window.removeEventListener("hidden-nav-changed", load);
  }, []);

  return { hiddenNav, enableTranslator };
}

export default useNavSettings;
