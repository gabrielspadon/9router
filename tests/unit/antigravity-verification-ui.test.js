import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/runtime", () => ({
  translate: (value) => ({
    "Verify Antigravity account": "Vérifier le compte Antigravity",
    "Check verification": "Vérifier la validation",
    "Antigravity account verification required": "La vérification du compte Antigravity est requise",
    "Sign in or use the local dashboard to verify Antigravity": "Connectez-vous ou utilisez le tableau de bord local pour vérifier Antigravity",
    "Verification link expired": "Le lien de vérification a expiré",
    "Unable to load verification link": "Impossible de charger le lien de vérification",
  }[value] || value),
}));

import ConnectionRow from "@/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SAFE_HREF = "https://accounts.google.com/AccountChooser?token=opaque";
const noop = () => {};

function renderRow(verification = null, hotReload = null) {
  return renderToStaticMarkup(createElement(ConnectionRow, {
    connection: { id: "conn-a", name: "Primary account", priority: 1, isActive: true, providerSpecificData: {} },
    proxyPools: [],
    isOAuth: true,
    isFirst: true,
    isLast: true,
    onMoveUp: noop,
    onMoveDown: noop,
    onToggleActive: noop,
    onUpdateProxy: noop,
    onEdit: noop,
    onDelete: noop,
    hotReload,
    verification,
  }));
}

function verification(overrides = {}) {
  return {
    connectionId: "conn-a",
    challengeId: "challenge-a",
    expiresAt: Date.now() + 60_000,
    href: SAFE_HREF,
    rechecking: false,
    error: null,
    onRecheck: vi.fn(),
    ...overrides,
  };
}

describe("Antigravity verification row UI", () => {
  it("renders the exact validated href with safe new-tab attributes", () => {
    const html = renderRow(verification());
    expect(html).toContain(`href="${SAFE_HREF}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders translated required-state and action labels without raw URL text", () => {
    const html = renderRow(verification());
    expect(html).toContain("La vérification du compte Antigravity est requise");
    expect(html).toContain("Vérifier le compte Antigravity");
    expect(html.replace(SAFE_HREF, "")).not.toContain("accounts.google.com");
  });

  it("combines translated action and connection name in the accessible anchor name", () => {
    const html = renderRow(verification());
    expect(html).toContain('aria-label="Vérifier le compte Antigravity Primary account"');
  });

  it("keeps the verification anchor keyboard focusable with a painted focus indicator", () => {
    const html = renderRow(verification());
    // Focus indication is the shared `focus-ring` utility defined once in
    // globals.css, rather than per-call focus-visible:ring-* classes. Asserting
    // the utility keeps the guarantee without pinning it to Tailwind internals.
    expect(html).toContain("focus-ring");
  });

  it("uses only the supplied callback for the explicit translated recheck action", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js"), "utf8");
    expect(renderRow(verification())).toContain("Vérifier la validation");
    expect(source).toContain("onClick={verification.onRecheck}");
  });

  it("keeps hot reload and verification controls enabled together", () => {
    const html = renderRow(verification(), { running: false, onRun: noop });
    expect(html).toContain("Hot reload");
    expect(html).toContain("Vérifier le compte Antigravity");
    const source = fs.readFileSync(path.join(ROOT, "src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js"), "utf8");
    expect(source).toContain("disabled={verification.rechecking}");
  });

  it("renders verification only for the matching connection row", () => {
    expect(renderRow(verification())).toContain("Vérifier le compte Antigravity");
    expect(renderRow(null)).not.toContain("Vérifier le compte Antigravity");
  });

  it("renders one translated accessible provider-page access explanation and no fallback anchor", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/app/(dashboard)/dashboard/providers/[id]/page.js"), "utf8");
    expect(source).toContain("antigravityVerification.accessDenied");
    expect(source).toContain('role="status"');
    expect(source).toContain('translate("Sign in or use the local dashboard to verify Antigravity")');
  });
});
