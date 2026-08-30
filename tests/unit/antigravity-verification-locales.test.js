import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LITERALS_DIR = path.join(ROOT, "public/i18n/literals");
const KEYS = [
  "Verify Antigravity account",
  "Check verification",
  "Antigravity account verification required",
  "Sign in or use the local dashboard to verify Antigravity",
  "Verification link expired",
  "Unable to load verification link",
];

vi.mock("@/i18n/runtime", () => ({
  translate: (value) => ({
    "Verify Antigravity account": "Vérifier le compte Antigravity",
    "Check verification": "Vérifier la validation",
    "Antigravity account verification required": "La vérification du compte Antigravity est requise",
  }[value] || value),
}));

import ConnectionRow from "@/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js";

const noop = () => {};

function catalogs() {
  return fs.readdirSync(LITERALS_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => [file, JSON.parse(fs.readFileSync(path.join(LITERALS_DIR, file), "utf8"))]);
}

function renderFrenchRow() {
  return renderToStaticMarkup(createElement(ConnectionRow, {
    connection: { id: "conn-a", name: "Compte principal", priority: 1, isActive: true, providerSpecificData: {} },
    proxyPools: [], isOAuth: true, isFirst: true, isLast: true,
    onMoveUp: noop, onMoveDown: noop, onToggleActive: noop, onUpdateProxy: noop, onEdit: noop, onDelete: noop,
    verification: {
      connectionId: "conn-a", challengeId: "challenge-a", expiresAt: Date.now() + 60_000,
      href: "https://accounts.google.com/AccountChooser?token=opaque", rechecking: false, error: null, onRecheck: noop,
    },
  }));
}

describe("Antigravity verification locale catalogs", () => {
  it("keeps exactly 34 catalogs and every approved source key", () => {
    const entries = catalogs();
    expect(entries).toHaveLength(34);
    for (const [, catalog] of entries) {
      for (const key of KEYS) expect(catalog).toHaveProperty(key);
    }
  });

  it("keeps every verification literal non-empty and French actions localized", () => {
    const entries = catalogs();
    for (const [, catalog] of entries) {
      for (const key of KEYS) {
        expect(typeof catalog[key]).toBe("string");
        expect(catalog[key].trim()).not.toBe("");
      }
    }
    const french = new Map(entries).get("fr.json");
    expect(french[KEYS[0]]).not.toBe(KEYS[0]);
    expect(french[KEYS[1]]).not.toBe(KEYS[1]);
  });

  it("renders a localized French accessible name while preserving Antigravity spelling", () => {
    const html = renderFrenchRow();
    expect(html).toContain('aria-label="Vérifier le compte Antigravity Compte principal"');
    expect(html).toContain("Vérifier le compte Antigravity");
    expect(html).not.toContain("Antigravité");
  });
});
