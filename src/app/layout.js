import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import "./globals.css";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import "@/lib/network/initOutboundProxy"; // Auto-initialize outbound proxy env
// The bootstrap moved to src/instrumentation.js, which runs at server boot on
// every entrypoint. This import stays as the fallback for a bare `next start`
// with instrumentation off, and is a no-op once the boot path has run.
import "@/shared/services/bootstrap";
import { initConsoleLogCapture } from "@/lib/consoleLogBuffer";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";
import { getServerLocale } from "@/i18n/server";
import { getLocaleDirection } from "@/i18n/config";
import { THEME_CONFIG } from "@/shared/constants/config";
import { getSettings } from "@/lib/db/index.js";

// Hook console immediately at module load time (server-side only, runs once)
initConsoleLogCapture();

// Runs before first paint so a dark-mode user never sees a light flash. It reads the
// exact key and JSON shape zustand's persist middleware writes in @/store/themeStore;
// that store stays the runtime owner, this only beats hydration to the DOM.
const THEME_PRE_PAINT_SCRIPT = `(function(){try{var s=localStorage.getItem("${THEME_CONFIG.storageKey}");var t=(s&&JSON.parse(s).state.theme)||"${THEME_CONFIG.defaultTheme}";if(t==="system")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}})();`;

// Icons are decorative and each action keeps a text or accessible label. Start
// their compact font after window load, so it does not compete with the route
// code and operator-readable first paint on constrained connections.
const ICON_FONT_READY_SCRIPT = `var d=document,r=d.documentElement,f=function(){r.classList.add('fonts-loaded')},l=function(){if(d.fonts&&d.fonts.load){d.fonts.load('24px "Material Symbols Outlined"').then(f).catch(f);setTimeout(f,3000)}else{f()}};if(typeof window==='undefined'||d.readyState==='complete')l();else window.addEventListener("load", l, { once: true });`;

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

// The three faces the design system names. Display and Technical were declared
// in the token layer but never loaded, so every `font-mono` in the product
// resolved to whatever monospace the platform happened to have and every
// heading was set in the interface face. `next/font` self-hosts and subsets
// them, so this costs two subset files, not two Google round trips.
const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const metadata = {
  title: "TokenProxy - AI Infrastructure Management",
  description: "One endpoint for all your AI providers. Manage keys, monitor usage, and scale effortlessly.",
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport = {
  themeColor: "#0a0a0a",
};

export default async function RootLayout({ children }) {
  const [settings, locale] = await Promise.all([getSettings(), getServerLocale()]);
  return (
    <html lang={locale} dir={getLocaleDirection(locale)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_PRE_PAINT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: ICON_FONT_READY_SCRIPT }} />
      </head>
      <body className={`${inter.variable} ${interTight.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <ThemeProvider>
          <RuntimeI18nProvider>
            {children}
          </RuntimeI18nProvider>
        </ThemeProvider>
        {settings.analyticsEnabled === true && <GoogleAnalytics gaId={"G-LC959F603F"} />}
      </body>
    </html>
  );
}
