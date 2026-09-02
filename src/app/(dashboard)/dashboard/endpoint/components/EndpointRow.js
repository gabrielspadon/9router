"use client";

import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";

/** Reusable endpoint row component */
export default function EndpointRow({ label, url, copyId, copied, onCopy, badge, actions }) {
  return (
    // gap-3 rather than gap-2: two adjacent icon buttons are 32px wide and
    // their 44px pointer targets have to sit 44 apart or the second one takes
    // a bite out of the first.
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
      <span className={`text-xs font-mono px-1.5 py-1 rounded shrink-0 min-w-[88px] text-center ${
          (badge === "CF" || badge === "TS") ? "bg-brand-soft text-brand" : "bg-surface-2 text-text-muted"
        }`}>{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 sm:flex-nowrap">
        <Input
          value={url}
          readOnly
          aria-label={`${label} endpoint URL`}
          className="min-w-0 flex-1 basis-full font-mono text-xs sm:basis-auto sm:text-sm"
        />
        <Button
          variant="bare" size="icon"
          onClick={() => onCopy(url, copyId)}
          className="hover:bg-surface-2 text-text-muted hover:text-brand shrink-0"
          title={copied === copyId ? "Copied" : "Copy endpoint URL"}
          aria-label={copied === copyId ? "Copied" : "Copy endpoint URL"}
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{copied === copyId ? "check" : "content_copy"}</span>
        </Button>
        {actions}
      </div>
    </div>
  );
}
