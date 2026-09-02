import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const matrix = readFileSync(
  resolve(root, "src/app/(dashboard)/dashboard/providers/components/ProviderHealthMatrix.js"),
  "utf8",
);
const page = readFileSync(
  resolve(root, "src/app/(dashboard)/dashboard/providers/page.js"),
  "utf8",
);

// direction.md:85, signature element 4: "Health, headroom, latency and error
// rate for every connected upstream in one grid." The element was declared and
// never built; these cases fail if it goes away again.
describe("provider health and quota matrix", () => {
  it("is rendered by the providers route", () => {
    expect(page).toContain("<ProviderHealthMatrix");
    expect(page).toContain('from "./components/ProviderHealthMatrix"');
  });

  it("reads measured health from the endpoint rather than inventing it", () => {
    expect(page).toContain("/api/usage/stats/health?period=7d&groupBy=provider");
  });

  it("carries all four quantities the element names", () => {
    for (const col of ["Requests", "Errors", "Latency", "Headroom"]) {
      expect(matrix).toContain(`<TH numeric>${col}</TH>`);
    }
  });

  it("is a grid, not a card set", () => {
    expect(matrix).toContain("@/shared/components/Table");
    expect(matrix).not.toContain("shared/components/Card");
  });

  it("never signals a state by hue alone", () => {
    // Every tone in the table is rendered through StatusToken, which pairs a
    // colour with a glyph and a word.
    expect(matrix).toContain("StatusToken");
    expect(matrix).toMatch(/<StatusToken tone=\{tone\}>/);
  });

  it("withholds a rate that has no denominator", () => {
    // Three requests, one error is not a 33 percent error rate.
    expect(matrix).toContain("const RATE_FLOOR = 20");
    expect(matrix).toContain("r.requests >= RATE_FLOOR");
  });

  it("reports the tightest quota window, not the average", async () => {
    const { headroomFor } = await import(
      resolve(root, "src/app/(dashboard)/dashboard/providers/components/ProviderHealthMatrix.js")
    );
    expect(
      headroomFor([
        { lastQuotaSnapshot: { windows: [{ key: "month", remainingPercentage: 80 }] } },
        { lastQuotaSnapshot: { windows: [{ key: "5h", remainingPercentage: 2 }] } },
      ]),
    ).toBe(2);
    // An unlimited window is not headroom of zero, and no snapshot at all is
    // not headroom of a hundred.
    expect(headroomFor([{ lastQuotaSnapshot: { windows: [{ key: "m", unlimited: true }] } }])).toBeNull();
    expect(headroomFor([{}])).toBeNull();
  });

  it("states the window the numbers were measured over", () => {
    expect(matrix).toContain("{period}");
  });

  // src/i18n/runtime.js keys the locale map on the whole trimmed text node, so
  // a node built by interpolation can never be looked up. The label and the
  // period code are therefore separate nodes.
  it("keeps the window label translatable by not interpolating it", () => {
    expect(matrix).not.toContain("`last ${period}`");
  });
});

// The evidence masker replaces the text of a link to /dashboard/providers/<id>
// with a stable alias (redactEvidence.mjs `connectedProviders`). A provider
// name printed as plain text beside a live error rate would survive into a
// published screenshot; routing it through that link is what stops it.
describe("provider identity in published evidence", () => {
  it("renders the upstream name as a provider link the masker recognises", () => {
    expect(matrix).toContain("/dashboard/providers/${r.provider}");
  });
});
