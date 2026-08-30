"use client";

import Link from "next/link";
import Image from "next/image";
import { Card, Badge } from "@/shared/components";

// Derive simple connected/configured/not-installed status from API payload
function getStatus(tool, status) {
  if (tool.unsupported) return { label: "Unsupported", variant: "danger" };
  if (!status) return { label: "Unknown", variant: "neutral" };
  if (!status.installed) return { label: "Not installed", variant: "neutral" };
  if (status.has9Router) return { label: "Connected", variant: "success" };
  return { label: "Not configured", variant: "warning" };
}

export default function ToolSummaryCard({ toolId, tool, status }) {
  const s = getStatus(tool, status);
  return (
    <Link href={`/dashboard/cli-tools/${toolId}`} className="block rounded-[14px] focus-ring">
      <Card padding="sm" className="h-full overflow-hidden hover:border-primary/50 transition-colors cursor-pointer">
        <div className="flex h-full flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="size-8 flex items-center justify-center shrink-0">
              {tool.image ? (
                <Image src={tool.image} alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} loading="lazy" decoding="async" />
              ) : tool.icon ? (
                <span className="material-symbols-outlined text-[28px]" style={{ color: tool.color }}>{tool.icon}</span>
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-sm truncate">{tool.name}</h3>
              <Badge variant={s.variant} size="md" className="mt-1">{s.label}</Badge>
            </div>
            <span className="material-symbols-outlined text-text-muted text-[18px] shrink-0">chevron_right</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
