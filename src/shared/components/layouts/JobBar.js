"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { useNavSettings } from "@/shared/hooks/useNavSettings";
import { NAV_JOBS, navItems, NAV_ID_BY_HREF } from "@/shared/components/Sidebar";

// design-system.md section 10: at phone width the rail becomes a bottom-anchored
// bar carrying the four jobs. The off-canvas drawer stays, because the System
// group and the debug tools have to remain reachable and nothing is dropped on
// the way down; what the drawer could not do is put the product's four jobs one
// tap away, which is the whole point of naming them in the rail.
//
// A job holds more than one destination, so a tap opens a sheet listing that
// job's routes rather than guessing which one was meant. That is the one action
// the design system allows between a row and its contextual pane.
const JOB_ICONS = {
  Connect: "dns",
  Compose: "layers",
  Point: "api",
  Watch: "insights",
};

export default function JobBar() {
  const pathname = usePathname();
  const { hiddenNav } = useNavSettings();
  const [openJob, setOpenJob] = useState(null);

  const visible = navItems.filter((item) => !hiddenNav.has(NAV_ID_BY_HREF[item.href]));
  const jobs = NAV_JOBS.map((job) => ({
    job,
    items: visible.filter((item) => item.job === job),
  })).filter((group) => group.items.length > 0);

  if (!jobs.length) return null;

  const sheet = jobs.find((group) => group.job === openJob);

  return (
    <nav
      aria-label="Jobs"
      className="relative shrink-0 border-t border-border bg-surface lg:hidden"
    >
      {sheet ? (
        <div className="absolute bottom-full inset-x-0 border-t border-border bg-surface">
          {sheet.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpenJob(null)}
              aria-current={pathname.startsWith(item.href) ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 border-s-2 px-4 text-[13px] font-medium transition-colors",
                pathname.startsWith(item.href)
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-transparent text-text-muted",
              )}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                {item.icon}
              </span>
              <span className="min-w-0">{item.label}</span>
            </Link>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-4">
        {jobs.map(({ job, items }) => {
          const active = items.some((item) => pathname.startsWith(item.href));
          return (
            <button
              key={job}
              type="button"
              aria-expanded={openJob === job}
              onClick={() => setOpenJob((current) => (current === job ? null : job))}
              className={cn(
                "flex min-h-11 flex-col items-center justify-center gap-1 border-t-2 py-1.5 transition-colors",
                active ? "border-brand text-brand" : "border-transparent text-text-muted",
              )}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                {JOB_ICONS[job]}
              </span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em]">{job}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
