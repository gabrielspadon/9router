"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useNotificationStore } from "@/store/notificationStore";
import Sidebar from "../Sidebar";
import Header from "../Header";
import Button from "@/shared/components/Button";
import { APP_CONFIG } from "@/shared/constants/config";
import SystemMasthead from "@/app/(dashboard)/dashboard/home/SystemMasthead";
import JobBar from "./JobBar";

function getToastStyle(type) {
  if (type === "success") {
    return {
      wrapper: "border-success-line bg-success-soft text-success",
      icon: "check_circle",
    };
  }
  if (type === "error") {
    return {
      wrapper: "border-danger-line bg-danger-soft text-danger",
      icon: "error",
    };
  }
  if (type === "warning") {
    return {
      wrapper: "border-warning-line bg-warning-soft text-warning",
      icon: "warning",
    };
  }
  return {
    wrapper: "border-info-line bg-info-soft text-info",
    icon: "info",
  };
}

export default function DashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const notifications = useNotificationStore((state) => state.notifications);
  const removeNotification = useNotificationStore((state) => state.removeNotification);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-bg">
      {/* First thing in the tab order: a keyboard user reaches the page without
          walking the whole rail. Off-screen until it takes focus. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-[90] focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-[var(--radius-brand)] focus:border focus:border-border focus:bg-surface focus:px-4 focus:text-sm focus:font-semibold focus:text-text-main focus:shadow-elev"
      >
        Skip to main content
      </a>
      <div
        aria-live="polite"
        className="fixed top-4 end-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2"
      >
        {notifications.map((n) => {
          const style = getToastStyle(n.type);
          return (
            <div
              key={n.id}
              className={`rounded-lg border px-3 py-2 shadow-elev backdrop-blur-sm ${style.wrapper}`}
            >
              <div className="flex items-start gap-2">
                <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-5">{style.icon}</span>
                <div className="min-w-0 flex-1">
                  {n.title ? <p className="text-xs font-semibold mb-1">{n.title}</p> : null}
                  <p className="text-xs whitespace-pre-wrap break-words">{n.message}</p>
                </div>
                {n.dismissible ? (
                  <Button
                    variant="bare" size="icon-sm"
                    type="button"
                    onClick={() => removeNotification(n.id)}
                    className="min-h-11 min-w-11 text-current/70 hover:text-current"
                    aria-label="Dismiss notification"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">close</span>
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - Desktop */}
      <div className="hidden lg:flex">
        <Sidebar label="Primary" />
      </div>

      {/* Sidebar - Mobile. The off-canvas copy is translated out of view, not
          unmounted, so without `inert` it is a second navigation landmark and a
          second copy of every link in the tab order at every viewport. */}
      {/* Anchored to the inline start with an RTL-aware slide. `start-0` alone
          would put the panel on the right in Farsi while `-translate-x-full`
          still parked it off the left edge, so the drawer would animate across
          the viewport instead of off its own side. */}
      <div
        inert={!sidebarOpen}
        className={`fixed inset-y-0 start-0 z-50 transform lg:hidden transition-transform duration-150 ease-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full"
        }`}
      >
        <Sidebar label="Mobile" onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Content column. The header sits OUTSIDE main so it is a banner: a
          <header> scoped to sectioning content carries no landmark role. */}
      <div className="flex flex-col flex-1 h-full min-w-0 relative transition-colors duration-150 isolate">
        {/* Faint grid background */}
        <div className="landing-grid absolute inset-0 pointer-events-none -z-10" aria-hidden="true" />
        <Header key={pathname} onMenuClick={() => setSidebarOpen(true)} />
        <SystemMasthead />
        <main
          id="main"
          className={`flex-1 overflow-y-auto custom-scrollbar ${pathname === "/dashboard/basic-chat" ? "" : "p-5.5 lg:p-8"} ${pathname === "/dashboard/basic-chat" ? "flex flex-col overflow-hidden" : ""}`}
        >
          <div className={`${pathname === "/dashboard/basic-chat" ? "flex-1 w-full h-full flex flex-col" : "max-w-7xl mx-auto"}`}>{children}</div>
        </main>
        {/* The rail becomes a bottom-anchored bar at phone width
            (design-system.md section 10). The drawer above stays for the System
            group and the debug tools; this carries the four jobs. */}
        <JobBar />
        <footer className="shrink-0 border-t border-border-subtle px-4 py-2 text-xs text-text-muted lg:px-8">
          {APP_CONFIG.name} v{APP_CONFIG.version}
        </footer>
      </div>
    </div>
  );
}
