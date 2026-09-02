"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Terminal state of an OAuth callback URL.
 * The provider's error wins over everything else: a denied authorization that
 * renders as a success tick tells the operator an account is connected when it
 * is not, and the popup closes over the only copy of the reason.
 */
export function callbackOutcome({ code, token, error }) {
  if (error) return "error";
  if (code || token) return "success";
  return "manual";
}

// How long the localStorage relay may live. The consumer (OAuthModal) ignores
// anything older than this, so past it the entry is only a credential at rest.
const RELAY_TTL_MS = 30_000;

/**
 * OAuth Callback Page Content
 */
function CallbackContent() {
  const searchParams = useSearchParams();
  const [closed, setClosed] = useState(false);

  const code = searchParams.get("code");
  const token = searchParams.get("token");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const outcome = callbackOutcome({ code, token, error });

  useEffect(() => {
    const callbackData = {
      code,
      token,
      state,
      error,
      errorDescription,
      fullUrl: window.location.href,
    };

    // Trusted origins that may receive this callback. The OAuth code/state
    // must only be relayed to the dashboard window we expect to be the opener
    // (same origin) or the Codex helper that listens on a fixed loopback port.
    // Any other origin is treated as hostile (drive-by attacker that opened
    // the popup against the well-known redirect_uri to phish the code).
    const expectedOrigins = [
      window.location.origin, // Same origin (for most providers)
      "http://localhost:1455", // Codex specific port
    ];

    // Method 1: postMessage to opener (popup mode)
    // Send once per expected origin. The browser delivers the message only
    // when the opener's origin matches the targetOrigin we pass — using "*"
    // here would leak the code/state to any opener (e.g. an attacker page
    // that opened this URL in a popup), so iterate over the allowlist.
    if (window.opener) {
      for (const origin of expectedOrigins) {
        try {
          window.opener.postMessage({ type: "oauth_callback", data: callbackData }, origin);
        } catch (e) {
          console.log("postMessage failed:", e);
        }
      }
    }

    // Method 2: BroadcastChannel (same origin tabs)
    try {
      const channel = new BroadcastChannel("oauth_callback");
      channel.postMessage(callbackData);
      channel.close();
    } catch (e) {
      console.log("BroadcastChannel failed:", e);
    }

    // Method 3: localStorage event (fallback for browsers without
    // BroadcastChannel). This entry holds the live code/token, so its lifetime
    // is bounded rather than left to whoever reads it: a popup that ran while
    // no dashboard tab was listening would otherwise leave the credential on
    // disk indefinitely.
    const dropRelay = () => {
      try {
        localStorage.removeItem("oauth_callback");
      } catch {
        // localStorage may be unavailable — nothing was written either
      }
    };
    let relayExpiry;
    try {
      localStorage.setItem("oauth_callback", JSON.stringify({ ...callbackData, timestamp: Date.now() }));
      relayExpiry = setTimeout(dropRelay, RELAY_TTL_MS);
      window.addEventListener("pagehide", dropRelay);
    } catch (e) {
      console.log("localStorage failed:", e);
    }

    const endRelay = () => {
      clearTimeout(relayExpiry);
      window.removeEventListener("pagehide", dropRelay);
      dropRelay();
    };

    if (outcome !== "success") return endRelay;

    const closeTimer = setTimeout(() => {
      window.close();
      setTimeout(() => setClosed(true), 500);
    }, 1500);
    return () => {
      clearTimeout(closeTimer);
      endRelay();
    };
  }, [code, token, state, error, errorDescription, outcome]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="text-center p-8 max-w-md">
        {outcome === "success" && (
          <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span aria-hidden="true" className="material-symbols-outlined text-3xl text-green-600">check_circle</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">Authorization Successful!</h1>
            <p className="text-text-muted">
              {closed ? "You can close this tab now." : "This window will close automatically..."}
            </p>
          </>
        )}

        {outcome === "error" && (
          <div role="alert">
            <div className="size-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span aria-hidden="true" className="material-symbols-outlined text-3xl text-red-600">error</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">Authorization Failed</h1>
            <p className="text-text-muted mb-4">
              {errorDescription || "The provider refused the authorization request."}
            </p>
            <p className="text-text-muted text-sm">
              No account was connected. Error code: <code className="break-all">{error}</code>
            </p>
          </div>
        )}

        {outcome === "manual" && (
          <>
            <div className="size-16 mx-auto mb-4 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
              <span aria-hidden="true" className="material-symbols-outlined text-3xl text-yellow-600">info</span>
            </div>
            <h1 className="text-xl font-semibold mb-2">Copy This URL</h1>
            <p className="text-text-muted mb-4">
              Please copy the URL from the address bar and paste it in the application.
            </p>
            <div className="bg-surface border border-border rounded-lg p-3 text-start">
              <code className="text-xs break-all">{typeof window !== "undefined" ? window.location.href : ""}</code>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * OAuth Callback Page
 * Receives callback from OAuth providers and sends data back via multiple methods
 */
export default function CallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="text-center p-8">
          <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
            <span aria-hidden="true" className="material-symbols-outlined text-3xl text-primary animate-spin">progress_activity</span>
          </div>
          <p className="text-text-muted">Loading...</p>
        </div>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  );
}
