import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TokenSaverClient from "@/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js";

// The page sits above its own aggregate figures. A savings range printed in the
// prose is a claim this instance never measured, and on a quiet instance it sat
// directly above a real zero.
const rendered = () =>
  renderToStaticMarkup(createElement(TokenSaverClient, {}))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

describe("token saver prose states no figure it did not measure", () => {
  it("uses literal code-guidance language for Ponytail", () => {
    const out = rendered();
    expect(out).toContain("Minimal code output");
    expect(out).not.toContain("Lazy senior dev");
  });

  it("carries no savings percentage in the feature descriptions", () => {
    const out = rendered();
    expect(out).not.toMatch(/60-90%/);
    expect(out).not.toMatch(/87%/);
    expect(out).not.toMatch(/~?65% fewer/);
    // No unsourced "N% fewer/less" anywhere in the copy.
    expect(out).not.toMatch(/\d+\s*%\s*(fewer|less|smaller|savings)/i);
  });

  it("still says what each saver does, so nothing was removed but the claim", () => {
    const out = rendered();
    expect(out).toMatch(/Compress tool output/);
    expect(out).toMatch(/git/);
    expect(out).toMatch(/Compress LLM output/);
    expect(out).toMatch(/Terse/i);
  });

  it("points at the measured readout instead of the claim", () => {
    expect(rendered()).toMatch(/measured|not measurable/i);
  });
});
