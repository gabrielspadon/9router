"use client";

import { Button, Input } from "@/shared/components";

/** Reusable endpoint row component */
export default function EndpointRow({ label, url, copyId, copied, onCopy, badge, actions }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-mono px-1.5 py-0.5 rounded shrink-0 min-w-[88px] text-center ${
          (badge === "CF" || badge === "TS") ? "bg-brand-soft text-brand" : "bg-surface-2 text-text-muted"
        }`}>{label}</span>
      <Input value={url} readOnly className="flex-1 font-mono text-sm" />
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
  );
}
