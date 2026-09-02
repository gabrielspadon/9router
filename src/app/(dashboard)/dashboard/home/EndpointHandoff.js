"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { translate } from "@/i18n/runtime";

// Signature element 5. The one URL a client needs, reachable from the masthead
// on every route, so answering "where do I point my tool" never costs a
// navigation away from whatever is on screen.
//
// The origin has to come from the browser: the server has no window, and a
// value baked at build time would be wrong for every operator who reaches the
// dashboard on a different host than the one it was built on. `location.origin`
// is a browser value that React can read directly rather than a piece of state
// this component owns, so it is read through `useSyncExternalStore`, whose
// server snapshot is the relative form. That is correct rather than merely
// blank, and it costs no render-then-correct pass.
const RELATIVE_BASE = "/v1";
const subscribe = () => () => {};
const clientBase = () => `${window.location.origin}${RELATIVE_BASE}`;
const serverBase = () => RELATIVE_BASE;

export default function EndpointHandoff() {
  const base = useSyncExternalStore(subscribe, clientBase, serverBase);
  const { copied, copy } = useCopyToClipboard();

  // A ready-made request, not a description of one. The point of the strip is
  // that an operator can paste rather than assemble, and assembling is where
  // the base URL, the path and the auth header get mismatched.
  const request = `curl ${base}/chat/completions \\
  -H "Authorization: Bearer $TOKENPROXY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'`;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-5.5 py-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
        {translate("Endpoint")}
      </span>
      <code
        className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-main"
        title={base}
      >
        {base}
      </code>
      <button
        type="button"
        onClick={() => copy(base, "base")}
        className="focus-ring inline-flex min-h-11 items-center gap-1 px-1.5 font-mono text-[10.5px] text-brand hover:text-brand-hover"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-sm">
          {copied === "base" ? "check" : "content_copy"}
        </span>
        {copied === "base" ? translate("Copied") : translate("Copy URL")}
      </button>
      <button
        type="button"
        onClick={() => copy(request, "request")}
        className="focus-ring inline-flex min-h-11 items-center gap-1 px-1.5 font-mono text-[10.5px] text-brand hover:text-brand-hover"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-sm">
          {copied === "request" ? "check" : "terminal"}
        </span>
        {copied === "request" ? translate("Copied") : translate("Copy request")}
      </button>
      <Link
        href="/dashboard/endpoint"
        className="focus-ring inline-flex min-h-11 items-center gap-1 px-1.5 font-mono text-[10.5px] text-text-muted hover:text-text-main"
      >
        <span aria-hidden="true" className="material-symbols-outlined dir-icon text-sm">arrow_forward</span>
        {translate("Keys and tunnel")}
      </Link>
      {/* The copy result is announced rather than only shown, because the label
          change is the whole feedback and a screen reader user would otherwise
          press the button and be told nothing happened. */}
      <span aria-live="polite" className="sr-only">
        {copied ? translate("Copied to clipboard") : ""}
      </span>
    </div>
  );
}
