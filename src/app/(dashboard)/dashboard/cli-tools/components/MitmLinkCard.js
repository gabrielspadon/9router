"use client";

import Link from "next/link";
import { Card, Badge } from "@/shared/components";
import Image from "next/image";

/**
 * Clickable card for MITM tools — navigates to /dashboard/mitm on click.
 */
export default function MitmLinkCard({ tool }) {
  return (
    <Link href="/dashboard/mitm" className="block rounded-[var(--radius-brand-lg)] focus-ring">
      <Card padding="sm" className="overflow-hidden hover:border-brand-solid transition-colors cursor-pointer">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-8 flex items-center justify-center shrink-0">
              <Image
                src={tool.image}
                alt={tool.name}
                width={32}
                height={32}
                className="size-8 object-contain rounded-lg"
                sizes="32px"
                onError={(e) => { e.target.style.display = "none"; }}
              loading="lazy"
              decoding="async"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-sm">{tool.name}</h3>
                <Badge variant="neutral" size="md">MITM</Badge>
              </div>
              <p className="text-xs text-text-muted">{tool.description}</p>
            </div>
          </div>
          <span aria-hidden="true" className="material-symbols-outlined dir-icon text-text-muted text-[20px]">chevron_right</span>
        </div>
      </Card>
    </Link>
  );
}
