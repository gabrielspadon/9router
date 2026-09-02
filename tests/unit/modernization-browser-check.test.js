import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { provenanceIssues, summarizeAudit } from "../../docs/design/verification/check-modernization-browser.mjs";

const auditDriver = readFileSync(
  new URL("../../docs/design/verification/audit2.mjs", import.meta.url),
  "utf8",
);

describe("modernization browser evidence", () => {
  it("accepts a clean route matrix", () => {
    const result = summarizeAudit({
      routes: {
        "mitm|light|desktop": {
          navError: null,
          consoleErrors: [],
          failedRequests: [],
          auditErrors: [],
          contrast: [],
          names: { unnamed: [] },
          focus: { bad: [] },
          hueOnly: [],
        },
      },
    });

    expect(result).toEqual({ views: 1, issues: [] });
  });

  it("fails closed when a route audit is incomplete or its document request fails", () => {
    const result = summarizeAudit({
      routes: {
        "usage|dark|desktop": {
          navError: null,
          consoleErrors: [],
          failedRequests: [],
          auditErrors: ["contrast evaluation failed"],
          contrast: [],
          names: { unnamed: [] },
          focus: { bad: [] },
          hueOnly: [],
        },
      },
    });

    expect(result.issues).toEqual(["usage|dark|desktop audit errors=1"]);
    expect(auditDriver).toContain("auditErrors");
    expect(auditDriver).toContain("r.status() >= 400");
    expect(auditDriver).toContain("unexpected final path");
  });

  it("reports audit defects by route and category, never request text", () => {
    const result = summarizeAudit({
      routes: {
        "mitm|dark|phone": {
          navError: "navigation failed",
          consoleErrors: ["sensitive browser output"],
          failedRequests: [],
          contrast: [{ ratio: 2 }],
          names: { unnamed: [{}] },
          focus: { bad: [{}] },
          tabOrder: { escaped: true, unnamed: 1 },
          hueOnly: [{}],
          reflow: { overflow: 8 },
        },
      },
    });

    expect(result.issues).toEqual([
      "mitm|dark|phone navigation failed",
      "mitm|dark|phone console errors=1",
      "mitm|dark|phone contrast failures=1",
      "mitm|dark|phone unnamed controls=1",
      "mitm|dark|phone focus failures=1",
      "mitm|dark|phone keyboard focus escaped=1",
      "mitm|dark|phone unnamed tab stops=1",
      "mitm|dark|phone hue-only indicators=1",
      "mitm|dark|phone reflow overflow=8",
    ]);
    expect(JSON.stringify(result.issues)).not.toContain("sensitive browser output");
  });

  it("records the seed and isolated build identity with each browser audit", () => {
    expect(auditDriver).toContain("AUDIT_SEED_DIGEST");
    expect(auditDriver).toContain("AUDIT_SOURCE_REVISION");
    expect(auditDriver).toContain("AUDIT_BUILD_ID");
    expect(auditDriver).toContain("provenance");
  });

  it("rejects browser evidence without its isolated build identity", () => {
    expect(provenanceIssues({ provenance: {} })).toEqual([
      "missing audit seed digest",
      "missing audit source revision",
      "missing audit build ID",
    ]);
  });
});
