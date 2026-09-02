// @vitest-environment jsdom
//
// BulkImportGrokCliModal + its wiring on the provider detail page (upstream abb20d9f3).
//
// The parser is the half that decides what a paste means, so it is exercised
// directly. The render half is asserted as roles and accessible names, the way
// unit/control-floor.test.js does it: a Material Symbols ligature is glyph text,
// never a name, so an icon-only control must carry one of its own.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const page = readFileSync(
  resolve(root, "src/app/(dashboard)/dashboard/providers/[id]/page.js"),
  "utf8"
);

const mod = await import("@/app/(dashboard)/dashboard/providers/[id]/BulkImportGrokCliModal.js");
const BulkImportGrokCliModal = mod.default;
const { parseAccountsInput } = mod;

const dom = (element) => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host;
};

const LIGATURE = /^[a-z0-9]+(_[a-z0-9]+)*$/;
const accessibleName = (el) => {
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return aria.trim();
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    if (el.id) {
      const label = el.ownerDocument.querySelector(`label[for="${el.id}"]`);
      if (label?.textContent?.trim()) return label.textContent.trim();
    }
    if (el.closest("label")?.textContent?.trim()) return el.closest("label").textContent.trim();
  }
  const text = el.textContent.trim();
  if (text && !LIGATURE.test(text)) return text;
  return el.getAttribute("title")?.trim() || "";
};

const render = (props = {}) =>
  dom(createElement(BulkImportGrokCliModal, { isOpen: true, onClose: () => {}, ...props }));

describe("parseAccountsInput", () => {
  it("returns an empty list for empty input", () => {
    expect(parseAccountsInput("")).toEqual([]);
    expect(parseAccountsInput("   \n ")).toEqual([]);
  });

  it("passes a JSON array through", () => {
    expect(parseAccountsInput('[{"access_token":"a"},{"access_token":"b"}]')).toHaveLength(2);
  });

  it("wraps a single object", () => {
    expect(parseAccountsInput('{"access_token":"a"}')).toEqual([{ access_token: "a" }]);
  });

  it("unwraps { accounts: [...] }", () => {
    expect(parseAccountsInput('{"accounts":[{"access_token":"a"}]}')).toEqual([{ access_token: "a" }]);
  });

  it("recovers concatenated objects pasted from several files", () => {
    expect(parseAccountsInput('{"access_token":"a"}{"access_token":"b"}')).toHaveLength(2);
    expect(parseAccountsInput('{"access_token":"a"},{"access_token":"b"},')).toHaveLength(2);
  });

  it("throws on input that is not JSON at all", () => {
    expect(() => parseAccountsInput("not json")).toThrow();
  });

  it("throws on a JSON scalar, which is not an account", () => {
    expect(() => parseAccountsInput("42")).toThrow();
  });
});

describe("BulkImportGrokCliModal render", () => {
  it("renders nothing while closed", () => {
    expect(render({ isOpen: false }).querySelector('[role="dialog"]')).toBeNull();
  });

  it("is a dialog named for what it imports", () => {
    const dialog = render().querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-label")).toMatch(/grok cli/i);
  });

  it("names the JSON textarea", () => {
    const ta = render().querySelector("textarea");
    expect(ta).not.toBeNull();
    expect(accessibleName(ta)).not.toBe("");
  });

  it("names the file input, which is visually hidden", () => {
    const file = render().querySelector('input[type="file"]');
    expect(file).not.toBeNull();
    expect(file.multiple).toBe(true);
    expect(accessibleName(file)).not.toBe("");
  });

  it("leaves no control without an accessible name", () => {
    const host = render();
    const controls = host.querySelectorAll("button, input, textarea, select, [role='button']");
    expect(controls.length).toBeGreaterThan(0);
    const unnamed = Array.from(controls).filter((el) => accessibleName(el) === "");
    expect(unnamed.map((el) => el.outerHTML)).toEqual([]);
  });

  it("submits to the grok-cli bulk-import route", () => {
    const src = readFileSync(
      resolve(root, "src/app/(dashboard)/dashboard/providers/[id]/BulkImportGrokCliModal.js"),
      "utf8"
    );
    expect(src).toContain("/api/oauth/grok-cli/bulk-import");
  });
});

describe("provider detail page wiring", () => {
  it("imports the modal", () => {
    expect(page).toMatch(/import BulkImportGrokCliModal from "\.\/BulkImportGrokCliModal"/);
  });

  it("mounts it only for grok-cli", () => {
    expect(page).toMatch(/providerId === "grok-cli" && \(\s*<BulkImportGrokCliModal/);
  });

  it("offers a Bulk Add control on the grok-cli provider", () => {
    const opens = page.match(/setShowBulkImportGrokCli\(true\)/g) || [];
    expect(opens.length).toBeGreaterThanOrEqual(1);
  });

  it("refreshes the connection list after a successful import", () => {
    expect(page).toMatch(/<BulkImportGrokCliModal[\s\S]{0,200}onSuccess=\{fetchConnections\}/);
  });
});
