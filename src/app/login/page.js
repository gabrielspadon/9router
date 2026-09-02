"use client";

import { useState, useEffect } from "react";
import { Card, Button, Input, AuthLayout } from "@/shared/components";

// Every SSO failure path redirects to /login?error=..., and nothing here read it:
// a provider that returns no id_token bounced the user back to a blank form with
// the reason visible only in the address bar (#3642). These are the codes the
// OIDC and SAML routes emit; anything else is already a sentence they built.
const SSO_ERRORS = {
  oidc_not_configured: "Single sign-on is not configured. Set the OIDC issuer, client ID and client secret first.",
  oidc_missing_code: "The identity provider did not return an authorization code.",
  oidc_invalid_state: "The sign-in request expired or did not match. Try signing in again.",
  oidc_start_failed: "Single sign-on could not be started. Check the OIDC issuer URL.",
  oidc_callback_failed: "Single sign-on failed while completing the callback.",
  saml_not_configured: "SAML single sign-on is not configured.",
  saml_missing_response: "The identity provider did not return a SAML response.",
  saml_start_failed: "SAML single sign-on could not be started.",
  saml_acs_failed: "SAML single sign-on failed while completing the callback.",
};

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetHint, setResetHint] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasPassword, setHasPassword] = useState(null);
  const [authMode, setAuthMode] = useState("password");
  const [ssoType, setSsoType] = useState("oidc");
  const [oidcConfigured, setOidcConfigured] = useState(false);
  const [oidcLoginLabel, setOidcLoginLabel] = useState("Sign in with OIDC");
  const [samlConfigured, setSamlConfigured] = useState(false);
  const [samlLoginLabel, setSamlLoginLabel] = useState("Sign in with SAML SSO");
  const [mustChange, setMustChange] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  // Countdown for rate-limit
  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => setRetryAfter((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  useEffect(() => {
    async function checkAuth() {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

      try {
        const res = await fetch(`${baseUrl}/api/auth/status`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data.authenticated === true || data.requireLogin === false) {
            window.location.assign("/dashboard");
            return;
          }
          setHasPassword(!!data.hasPassword);
          setAuthMode(data.authMode || "password");
          setSsoType(data.ssoType || "oidc");
          setOidcConfigured(data.oidcConfigured === true);
          setOidcLoginLabel(data.oidcLoginLabel || "Sign in with OIDC");
          setSamlConfigured(data.samlConfigured === true);
          setSamlLoginLabel(data.samlLoginLabel || "Sign in with SAML SSO");
        } else {
          // Safe fallback on non-OK response to avoid infinite loading state.
          setHasPassword(true);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        setHasPassword(true);
      }

      // Only reached when the login form is actually shown; a session that
      // redirects to /dashboard above has nothing to report (#3642).
      const reason = new URLSearchParams(window.location.search).get("error");
      if (!reason) return;
      setError(SSO_ERRORS[reason] || reason);
      const cleaned = new URL(window.location.href);
      cleaned.searchParams.delete("error");
      window.history.replaceState({}, "", cleaned.pathname + cleaned.search + cleaned.hash);
    }
    checkAuth();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResetHint("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.mustChangePassword) {
          setMustChange(true);
          return;
        }
        window.location.assign("/dashboard");
      } else {
        const data = await res.json();
        setError(data.error || "Invalid password");
        if (data.resetHint) setResetHint(data.resetHint);
        if (data.retryAfter) setRetryAfter(Number(data.retryAfter));
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Force a new password before entering the dashboard (default + remote).
  const handleSetNewPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: password, newPassword }),
      });
      if (res.ok) {
        window.location.assign("/dashboard");
      } else {
        const data = await res.json();
        setError(data.error || "Failed to set password");
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOidcLogin = () => {
    window.location.href = "/api/auth/oidc/start";
  };

  const handleSamlLogin = () => {
    window.location.href = "/api/auth/saml/start";
  };

  const isSsoEnabled = ["sso", "oidc", "saml", "both"].includes(authMode);
  const activeSsoType = ssoType || (authMode === "saml" ? "saml" : "oidc");

  const samlAvailable = isSsoEnabled && activeSsoType === "saml" && samlConfigured;
  const oidcAvailable = isSsoEnabled && activeSsoType === "oidc" && oidcConfigured;
  const ssoAvailable = samlAvailable || oidcAvailable;

  const passwordAvailable = authMode === "password" || authMode === "both" || !ssoAvailable;

  // Show loading state while checking password
  if (hasPassword === null) {
    return (
      <AuthLayout>
        <div className="text-center">
          <div
            className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-brand"
            role="status"
            aria-label="Loading"
          ></div>
          <p className="text-sm text-text-muted mt-4">Loading...</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center gap-3 mb-5.5">
          <div className="flex items-center gap-3">
            <span
              className="flex size-8 items-center justify-center rounded-[var(--radius-brand)] bg-brand-soft border border-brand-line text-brand"
              aria-hidden="true"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">hub</span>
            </span>
            <h1 className="text-lg font-semibold text-text-main">TokenProxy</h1>
          </div>
          <p className="text-sm text-text-muted">
            {samlAvailable
              ? "Sign in with SAML 2.0 Single Sign-On"
              : oidcAvailable
              ? "Sign in with your OIDC provider to access the dashboard"
              : "Enter your password to access the dashboard"}
          </p>
        </div>

        <Card padding="none" className="p-5.5">
          {mustChange ? (
            <form onSubmit={handleSetNewPassword} className="flex flex-col gap-4">
              <p className="flex items-start gap-1.5 text-xs text-warning">
                <span className="material-symbols-outlined text-[14px] shrink-0" aria-hidden="true">
                  key
                </span>
                <span className="min-w-0">Set a new password before accessing the dashboard remotely.</span>
              </p>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-text-main" htmlFor="new-password">
                  New password
                </label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoFocus
                  inputClassName="focus-ring"
                />
                {error && (
                  <p className="flex items-start gap-1.5 text-xs text-danger" role="alert">
                    <span className="material-symbols-outlined text-[14px] shrink-0" aria-hidden="true">
                      error
                    </span>
                    <span className="min-w-0">{error}</span>
                  </p>
                )}
              </div>
              <Button
                type="submit"
                variant="primary"
                className="w-full focus-ring"
                loading={loading}
                disabled={!newPassword}
              >
                Set password
              </Button>
            </form>
          ) : (
          <div className="flex flex-col gap-4">
            {samlAvailable && (
              <Button type="button" variant="primary" className="w-full focus-ring" onClick={handleSamlLogin}>
                {samlLoginLabel}
              </Button>
            )}

            {oidcAvailable && (
              <Button type="button" variant="primary" className="w-full focus-ring" onClick={handleOidcLogin}>
                {oidcLoginLabel}
              </Button>
            )}

            {ssoAvailable && passwordAvailable && <div className="h-px bg-border/60" />}

            {passwordAvailable ? (
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                {isSsoEnabled && !ssoAvailable && (
                  <p className="flex items-start gap-1.5 text-xs text-warning">
                    <span className="material-symbols-outlined text-[14px] shrink-0" aria-hidden="true">
                      warning
                    </span>
                    <span className="min-w-0">
                      {activeSsoType === "saml" ? "SAML SSO" : "OIDC"} login is enabled, but configuration is incomplete. Password login is still available for recovery.
                    </span>
                  </p>
                )}

                {authMode === "both" && ssoAvailable && (
                  <p className="text-xs text-text-muted">
                    Password and {activeSsoType === "saml" ? "SAML SSO" : "OIDC"} login are both enabled.
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-text-main" htmlFor="password">
                    Password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus={!oidcAvailable}
                    inputClassName="focus-ring"
                  />
                  {error && (
                    <p className="flex items-start gap-1.5 text-xs text-danger" role="alert">
                      <span className="material-symbols-outlined text-[14px] shrink-0" aria-hidden="true">
                        error
                      </span>
                      <span className="min-w-0">{error}</span>
                    </p>
                  )}
                  {retryAfter > 0 && (
                    <p className="flex items-start gap-1.5 text-xs text-warning">
                      <span className="material-symbols-outlined text-[14px] shrink-0" aria-hidden="true">
                        lock_clock
                      </span>
                      <span className="min-w-0">
                        Locked. Retry in <span className="font-mono metric">{retryAfter}s</span>.
                      </span>
                    </p>
                  )}
                  {resetHint && (
                    <p className="text-xs text-text-muted">
                      Forgot password? Open <code className="bg-surface-2 px-1 rounded">tokenproxy</code> CLI on the host → <b>Settings</b> → <b>Reset Password to Default</b>.
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full focus-ring"
                  loading={loading}
                  disabled={retryAfter > 0}
                >
                  {retryAfter > 0 ? `Wait ${retryAfter}s` : "Login"}
                </Button>

                {/* Only advertise the default while it is still what logs you
                    in: hasPassword false is exactly the case where the server
                    falls back to INITIAL_PASSWORD or the built-in default.
                    A failed status check leaves hasPassword true, so the hint
                    stays hidden when we cannot tell. */}
                {hasPassword === false && (
                  <p className="text-xs text-center text-text-muted mt-2">
                    No password set yet, so <code className="bg-surface-2 px-1 rounded">123456</code>{" "}
                    still works (or INITIAL_PASSWORD, if it was set before first launch).
                  </p>
                )}
                {hasPassword === false && (
                  <p className="flex items-start gap-1.5 text-xs text-warning">
                    <span className="material-symbols-outlined text-[14px] shrink-0" aria-hidden="true">
                      warning
                    </span>
                    <span className="min-w-0">
                      Security risk: no password set. You will be asked to set one when logging in remotely.
                    </span>
                  </p>
                )}
              </form>
            ) : (
              error && (
                <p className="flex items-start gap-1.5 text-xs text-danger" role="alert">
                  <span className="material-symbols-outlined text-[14px] shrink-0" aria-hidden="true">
                    error
                  </span>
                  <span className="min-w-0">{error}</span>
                </p>
              )
            )}
          </div>
          )}
        </Card>
      </div>
    </AuthLayout>
  );
}
