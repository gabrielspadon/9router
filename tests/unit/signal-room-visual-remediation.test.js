import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const providerDetail = read("../../src/app/(dashboard)/dashboard/providers/[id]/page.js");
const statistics = read("../../src/app/(dashboard)/dashboard/statistics/StatisticsContent.js");
const multiSelect = read("../../src/shared/components/MultiSelect.js");
const requestDetails = read("../../src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js");
const endpointRow = read("../../src/app/(dashboard)/dashboard/endpoint/components/EndpointRow.js");
const tokenSaver = read("../../src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js");
const combos = read("../../src/app/(dashboard)/dashboard/combos/page.js");

describe("Signal Room visual remediation", () => {
  it("keeps the no-connection action before risk and timeout controls on phone", () => {
    const mobileCta = providerDetail.indexOf('className="sm:hidden"');
    expect(mobileCta).toBeGreaterThan(-1);
    expect(providerDetail.indexOf("Add Connection", mobileCta)).toBeGreaterThan(mobileCta);
    expect(providerDetail.indexOf("Risk Notice", mobileCta)).toBeGreaterThan(mobileCta);
    expect(providerDetail.indexOf("<ConnectTimeoutInput", mobileCta)).toBeGreaterThan(mobileCta);
  });

  it("uses a native period chooser on phone while retaining desktop segments", () => {
    expect(statistics).toContain('aria-label="Statistics period"');
    expect(statistics).toMatch(/className="[^"]*sm:hidden"/);
    expect(statistics).toContain('className="hidden sm:inline-flex"');
  });

  it("names and describes statistics multi-selects to assistive technology", () => {
    expect(multiSelect).toContain("<label htmlFor={buttonId}");
    expect(multiSelect).toContain('aria-expanded={open}');
    expect(multiSelect).toContain('aria-controls={listboxId}');
    expect(multiSelect).toContain('`${selected.length} ${label || "items"} selected`');
  });

  it("uses native pressed controls instead of focusable listbox options", () => {
    expect(multiSelect).toContain('role="group"');
    expect(multiSelect).toContain("aria-pressed={allSelected}");
    expect(multiSelect).toContain("aria-pressed={isSel}");
    expect(multiSelect).not.toContain('role="option"');
    expect(multiSelect).not.toContain("aria-selected=");
  });

  it("distinguishes disabled request-detail recording from an empty result", () => {
    expect(requestDetails).toContain("setObservability(data.observability");
    expect(requestDetails).toContain("Request-detail recording is disabled");
  });

  it("stacks endpoint identity above a full-width URL on phone", () => {
    expect(endpointRow).toContain("flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3");
  });

  it("keeps the complete endpoint readable beside its copy action on desktop", () => {
    expect(endpointRow).toContain("flex min-w-0 flex-1 flex-wrap items-center gap-3 sm:flex-nowrap");
  });

  it("gives the endpoint its own line before phone copy controls", () => {
    expect(endpointRow).toContain("min-w-0 flex-1 basis-full font-mono text-xs sm:basis-auto sm:text-sm");
  });

  it("states the Token Saver data boundary before controls", () => {
    expect(tokenSaver).toContain("Data boundary");
    expect(tokenSaver).toContain("RTK rewrites tool output locally");
    expect(tokenSaver).toContain("PXPIPE renders context as images in-process");
  });

  it("keeps Combo explanation full-width through the 200 percent reflow viewport", () => {
    expect(combos).toContain('gap-3 lg:flex-row lg:items-center lg:justify-between');
    expect(combos).toContain('lg:w-auto lg:flex-row lg:shrink-0');
  });
});
