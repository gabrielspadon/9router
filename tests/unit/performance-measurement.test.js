import { describe, expect, it } from "vitest";
import * as performanceMeasurement from "../../docs/design/verification/performance.mjs";
import { buildEvidencePrivacyContext } from "../../docs/design/verification/redactEvidence.mjs";

const { percentile, renderPerformanceReport, summarizeMeasurements } = performanceMeasurement;

describe("browser performance evidence", () => {
  it("collects structured LCP, long-task, navigation, and resource entries", () => {
    expect(performanceMeasurement.installPerformanceObservers).toBeTypeOf("function");
    expect(performanceMeasurement.readPerformanceSnapshot).toBeTypeOf("function");

    const callbacks = new Map();
    class FakePerformanceObserver {
      constructor(callback) {
        this.callback = callback;
      }

      observe({ type }) {
        callbacks.set(type, this.callback);
      }
    }
    const target = {};
    performanceMeasurement.installPerformanceObservers(target, FakePerformanceObserver);
    callbacks.get("largest-contentful-paint")({
      getEntries: () => [{
        startTime: 120,
        renderTime: 118,
        loadTime: 110,
        size: 2048,
        url: "https://router.test/hero.webp",
        element: { tagName: "IMG", id: "hero", classList: ["wide", "hero"] },
      }],
    });
    callbacks.get("longtask")({
      getEntries: () => [{
        name: "self",
        startTime: 40,
        duration: 65,
        attribution: [{ name: "same-origin", containerType: "window" }],
      }],
    });

    const snapshot = performanceMeasurement.readPerformanceSnapshot(target, {
      getEntriesByType: (type) => type === "navigation"
        ? [{ duration: 300 }]
        : [{
            name: "https://router.test/app.js",
            initiatorType: "script",
            startTime: 10,
            duration: 20,
            redirectStart: 0,
            redirectEnd: 0,
            domainLookupStart: 10,
            domainLookupEnd: 10,
            connectStart: 10,
            secureConnectionStart: 0,
            connectEnd: 10,
            requestStart: 12,
            responseStart: 18,
            responseEnd: 30,
            transferSize: 100,
            encodedBodySize: 80,
            decodedBodySize: 160,
          }],
    });

    expect(snapshot).toEqual({
      navigation: { duration: 300 },
      observerSupport: { lcp: true, longTask: true },
      lcp: {
        startTime: 120,
        renderTime: 118,
        loadTime: 110,
        size: 2048,
        url: "https://router.test/hero.webp",
        element: { tagName: "img", id: "hero", classNames: ["hero", "wide"] },
      },
      longTasks: [{
        name: "self",
        startTime: 40,
        duration: 65,
        attribution: [{
          name: "same-origin",
          containerType: "window",
          containerName: null,
          containerId: null,
          containerSrc: null,
        }],
      }],
      resources: [{
        name: "https://router.test/app.js",
        initiatorType: "script",
        startTime: 10,
        duration: 20,
        redirectStart: 0,
        redirectEnd: 0,
        domainLookupStart: 10,
        domainLookupEnd: 10,
        connectStart: 10,
        secureConnectionStart: 0,
        connectEnd: 10,
        requestStart: 12,
        responseStart: 18,
        responseEnd: 30,
        transferSize: 100,
        encodedBodySize: 80,
        decodedBodySize: 160,
      }],
    });
  });

  it("retains the LCP element identity, URL, size, and timings", () => {
    expect(performanceMeasurement.normalizePerformanceSnapshot).toBeTypeOf("function");

    const measurement = performanceMeasurement.normalizePerformanceSnapshot({
      navigation: { duration: 123.456 },
      lcp: {
        startTime: 100.126,
        renderTime: 90.125,
        loadTime: 80.124,
        size: 4096,
        url: "https://router.test/_next/hero.png?token=secret#detail",
        element: { tagName: "IMG", id: "hero", classNames: ["wide", "hero"] },
      },
      longTasks: [],
      resources: [],
    });

    expect(measurement).toMatchObject({
      navMs: 123.46,
      lcpMs: 100.13,
      lcp: {
        startTimeMs: 100.13,
        renderTimeMs: 90.13,
        loadTimeMs: 80.12,
        size: 4096,
        url: "https://router.test/_next/hero.png",
        element: { tagName: "img", id: "hero", classNames: ["hero", "wide"] },
      },
    });
  });

  it("retains every long task timing in deterministic order", () => {
    const measurement = performanceMeasurement.normalizePerformanceSnapshot({
      navigation: { duration: 100 },
      lcp: null,
      longTasks: [
        {
          name: "same-origin",
          startTime: 300.005,
          duration: 55.555,
          attribution: [{
            name: "same-origin",
            containerType: "iframe",
            containerName: "status",
            containerId: "status-frame",
            containerSrc: "https://router.test/status?session=secret#detail",
          }],
        },
        { name: "self", startTime: 100.004, duration: 70.126, attribution: [] },
      ],
      resources: [],
    });

    expect(measurement.longTaskMs).toBe(70.13);
    expect(measurement.longTasks).toEqual([
      {
        name: "self",
        startTimeMs: 100,
        durationMs: 70.13,
        attribution: [],
      },
      {
        name: "same-origin",
        startTimeMs: 300.01,
        durationMs: 55.56,
        attribution: [{
          name: "same-origin",
          containerType: "iframe",
          containerName: "status",
          containerId: "status-frame",
          containerSrc: "https://router.test/status",
        }],
      },
    ]);
  });

  it("distinguishes unsupported observers from zero measured long tasks", () => {
    const measurement = performanceMeasurement.normalizePerformanceSnapshot({
      navigation: { duration: 100 },
      observerSupport: { lcp: false, longTask: false },
      lcp: null,
      longTasks: [],
      resources: [],
    });

    expect(measurement).toMatchObject({
      lcpMs: null,
      longTaskMs: null,
      observerSupport: { lcp: false, longTask: false },
    });
  });

  it("retains categorized timing and sizes for each resource", () => {
    const measurement = performanceMeasurement.normalizePerformanceSnapshot({
      navigation: { duration: 250 },
      lcp: null,
      longTasks: [],
      resources: [
        {
          name: "https://router.test/hero.webp?cache=one#image",
          initiatorType: "img",
          startTime: 200,
          duration: 50,
          redirectStart: 0,
          redirectEnd: 0,
          domainLookupStart: 205,
          domainLookupEnd: 210,
          connectStart: 210,
          secureConnectionStart: 215,
          connectEnd: 225,
          requestStart: 230,
          responseStart: 240,
          responseEnd: 250,
          transferSize: 2000,
          encodedBodySize: 1800,
          decodedBodySize: 3600,
        },
        {
          name: "https://router.test/app.js",
          initiatorType: "script",
          startTime: 100,
          duration: 40,
          redirectStart: 0,
          redirectEnd: 0,
          domainLookupStart: 100,
          domainLookupEnd: 100,
          connectStart: 100,
          secureConnectionStart: 0,
          connectEnd: 100,
          requestStart: 105,
          responseStart: 120,
          responseEnd: 140,
          transferSize: 1000,
          encodedBodySize: 900,
          decodedBodySize: 1800,
        },
      ],
    });

    expect(measurement.transferBytes).toBe(3000);
    expect(measurement.resourceTimings).toEqual([
      {
        url: "https://router.test/app.js",
        initiatorType: "script",
        startTimeMs: 100,
        durationMs: 40,
        timingMs: { redirect: 0, dns: 0, connect: 0, tls: 0, request: 15, response: 20 },
        transferBytes: 1000,
        encodedBodyBytes: 900,
        decodedBodyBytes: 1800,
      },
      {
        url: "https://router.test/hero.webp",
        initiatorType: "img",
        startTimeMs: 200,
        durationMs: 50,
        timingMs: { redirect: 0, dns: 5, connect: 15, tls: 10, request: 10, response: 10 },
        transferBytes: 2000,
        encodedBodyBytes: 1800,
        decodedBodyBytes: 3600,
      },
    ]);
  });

  it("builds raw rows without flattening structured diagnostics", () => {
    expect(performanceMeasurement.buildMeasurementRow).toBeTypeOf("function");
    const lcp = { startTimeMs: 120, element: { tagName: "img" } };
    const longTasks = [{ startTimeMs: 40, durationMs: 65 }];
    const resourceTimings = [{ url: "https://router.test/app.js", durationMs: 20 }];

    expect(performanceMeasurement.buildMeasurementRow("dashboard", "cold", {
      navMs: 300,
      lcpMs: 120,
      longTaskMs: 65,
      transferBytes: 100,
      lcp,
      longTasks,
      resourceTimings,
    }, [])).toEqual({
      route: "dashboard",
      mode: "cold",
      navMs: 300,
      lcpMs: 120,
      longTaskMs: 65,
      transferBytes: 100,
      lcp,
      longTasks,
      resourceTimings,
      problems: [],
    });
  });

  it("reports median and p75 by route and cache mode", () => {
    const report = summarizeMeasurements([
      { route: "dashboard", mode: "cold", navMs: 100, lcpMs: 120, longTaskMs: 0, transferBytes: 1000 },
      { route: "dashboard", mode: "cold", navMs: 200, lcpMs: 220, longTaskMs: 60, transferBytes: 1100 },
      { route: "dashboard", mode: "cold", navMs: 300, lcpMs: 320, longTaskMs: 0, transferBytes: 1200 },
    ]);

    expect(report).toEqual([
      {
        route: "dashboard",
        mode: "cold",
        samples: 3,
        navMs: { median: 200, p75: 250 },
        lcpMs: { median: 220, p75: 270 },
        longTaskMs: { max: 60 },
        transferBytes: { median: 1100 },
      },
    ]);
  });

  it("reports unavailable budget measurements as unavailable instead of zero", () => {
    const summary = summarizeMeasurements([{
      route: "dashboard",
      mode: "cold",
      navMs: 300,
      lcpMs: null,
      longTaskMs: null,
      transferBytes: 1000,
    }]);

    expect(summary[0].lcpMs).toEqual({ median: null, p75: null });
    expect(summary[0].longTaskMs).toEqual({ max: null });

    const markdown = renderPerformanceReport({
      generatedAt: "2026-09-01T12:00:00.000Z",
      base: "http://127.0.0.1:20149",
      summary,
    });
    expect(markdown).toContain("dashboard cold LCP p75 was not recorded");
    expect(markdown).toContain("dashboard cold long-task observation was not recorded");
    expect(markdown).not.toContain("No measured LCP or long-task budget gap");
  });

  it("redacts the base URL, resource URLs, and captured problem text before writing evidence", () => {
    expect(performanceMeasurement.buildPerformanceReport).toBeTypeOf("function");

    const report = performanceMeasurement.buildPerformanceReport([{
      route: "dashboard",
      mode: "cold",
      sample: 1,
      navMs: 100,
      lcpMs: 200,
      longTaskMs: 10,
      transferBytes: 1000,
      resourceTimings: [{ url: "http://127.0.0.1:20152/_next/app.js", transferBytes: 1000 }],
      problems: ["console failed to load http://localhost:8787/health"],
    }], { base: "http://127.0.0.1:20152", samples: 3, provenance: "" });

    expect(report.base).toBe("[redacted-local-endpoint]");
    expect(report.measurements[0].resourceTimings[0].url).toBe("[redacted-local-endpoint]");
    expect(report.problems[0].problem).not.toContain("localhost:8787");
    expect(JSON.stringify(report)).not.toMatch(/127\.0\.0\.1|localhost/);
    expect(report.measurements[0].navMs).toBe(100);

    expect(performanceMeasurement.renderPerformanceReport(report))
      .not.toMatch(/127\.0\.0\.1|localhost/);
  });

  it("masks a connection label echoed into a captured problem via the privacy context", () => {
    const privacyContext = buildEvidencePrivacyContext({
      connections: [{ name: "Gabriel work key", provider: "anthropic" }],
      nodes: [],
    });

    const report = performanceMeasurement.buildPerformanceReport([{
      route: "providers",
      mode: "cold",
      sample: 1,
      navMs: 100,
      resourceTimings: [],
      problems: ["console refresh failed for Gabriel work key"],
    }], { base: "http://127.0.0.1:20152", samples: 3, provenance: "", privacyContext });

    expect(JSON.stringify(report)).not.toContain("Gabriel work key");
    // A short node name must not rewrite words inside the authored conditions text.
    expect(report.conditions.note).toContain("Local isolated production build");
  });

  it("interpolates the percentile between ordered timing samples", () => {
    expect(percentile([1, 2, 3, 4], 0.75)).toBe(3.25);
  });

  it("renders the measured build identity and budget gaps from the raw report", () => {
    const markdown = renderPerformanceReport({
      generatedAt: "2026-09-01T12:00:00.000Z",
      base: "http://127.0.0.1:20149",
      conditions: { browser: "Chromium headless", samplesPerRouteAndMode: 3 },
      provenance: { sourceDigest: "current-build", buildId: "build-current" },
      problems: [],
      summary: [{
        route: "dashboard",
        mode: "cold",
        samples: 3,
        navMs: { median: 1500, p75: 2100 },
        lcpMs: { median: 1900, p75: 2200 },
        longTaskMs: { max: 88 },
        transferBytes: { median: 123456 },
      }],
    });

    expect(markdown).toContain("build-current");
    expect(markdown).toContain("current-build");
    expect(markdown).toContain("| dashboard | cold | 2100 | 2200 | 123456 | 88 |");
    expect(markdown).toContain("LCP p75 exceeds the 1,800 ms target");
    expect(markdown).toContain("long task exceeds the 50 ms target");
    expect(markdown).toContain("No budget is reported as a pass");
  });
});
