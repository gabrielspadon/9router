"use client";

import { Suspense, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { UsageStats, RequestLogger, CardSkeleton, SegmentedControl } from "@/shared/components";
import RequestDetailsTab from "./components/RequestDetailsTab";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  // The API and the repo have always accepted "all" — VALID_PERIODS lists it and
  // periodCutoffIso returns null for it — but the picker never offered it, so
  // all-time usage was unreachable from the dashboard (#2410).
  { value: "all", label: "All" },
];

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageContent />
    </Suspense>
  );
}

function UsageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // The period lives in the URL, exactly as the tab does. As component state it
  // reset to "today" on any remount — a navigation back, a refresh, a shared
  // link — so the figures the user was reading silently changed underneath
  // them, which is the usage bug in the report (#1639).
  const periodFromUrl = searchParams.get("period");
  const period = PERIODS.some((p) => p.value === periodFromUrl) ? periodFromUrl : "today";

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "logs", "details"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const pushParam = useCallback((key, value) => {
    const params = new URLSearchParams(searchParams);
    params.set(key, value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    pushParam("tab", value);
  };

  const setPeriod = useCallback((value) => {
    if (value === period) return;
    pushParam("period", value);
  }, [period, pushParam]);

  return (
    <div className="flex min-w-0 flex-col gap-5.5">
      {/* Tabs + period selector on same row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          options={[
            { value: "overview", label: "Overview" },
            { value: "details", label: "Details" },
          ]}
          value={activeTab}
          onChange={handleTabChange}
          className="w-full sm:w-auto"
        />
        {activeTab === "overview" && (
          <SegmentedControl
            options={PERIODS}
            value={period}
            onChange={setPeriod}
            size="sm"
            className="w-full sm:w-auto"
          />
        )}
      </div>

      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats period={period} setPeriod={setPeriod} hidePeriodSelector />
        </Suspense>
      )}
      {activeTab === "logs" && <RequestLogger />}
      {activeTab === "details" && <RequestDetailsTab />}
    </div>
  );
}
