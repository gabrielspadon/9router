// @vitest-environment jsdom
//
// The connect-timeout contract used to hold this by asserting the literal source
// text of Toggle.js: `aria-label={ariaLabel || label || undefined}`. That broke the
// moment the component's naming was generalised to also accept `title` and to skip a
// non-string `label`, even though the generalisation is strictly better. A source
// string is not the contract; the accessible name is. This file asserts the name.
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

const { default: Toggle } = await import("../../src/shared/components/Toggle.js");

let container = null;
let root = null;

function render(props) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Toggle {...props} />));
  return container.querySelector('[role="switch"], button, input');
}

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  root = null;
  container = null;
});

// The accessible name of a control, as a screen reader would compute it for the
// simple cases this component produces: an explicit aria-label, else its text.
const accessibleName = (el) =>
  el?.getAttribute("aria-label") || el?.textContent?.trim() || null;

describe("Toggle accessible name", () => {
  it("uses ariaLabel when given, which is the most specific source", () => {
    const el = render({
      ariaLabel: "Use Fast tier for Codex Sol models",
      label: "Fast tier",
      checked: false,
      onChange: () => {},
    });
    expect(accessibleName(el)).toBe("Use Fast tier for Codex Sol models");
  });

  it("falls back to a string label", () => {
    const el = render({ label: "Require API key", checked: true, onChange: () => {} });
    expect(accessibleName(el)).toBe("Require API key");
  });

  it("falls back to title when there is no label", () => {
    const el = render({ title: "Enable this connection", checked: false, onChange: () => {} });
    expect(accessibleName(el)).toBe("Enable this connection");
  });

  it("does not name itself with a non-string label, which would stringify to junk", () => {
    const el = render({
      label: <span>Require API key</span>,
      title: "Require API key",
      checked: false,
      onChange: () => {},
    });
    expect(el.getAttribute("aria-label")).toBe("Require API key");
  });

  it("has no accessible name at all when nothing was passed, so the gap is visible", () => {
    const el = render({ checked: false, onChange: () => {} });
    expect(el.getAttribute("aria-label")).toBeNull();
  });
});
