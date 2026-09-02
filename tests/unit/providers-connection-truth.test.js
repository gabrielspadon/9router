// Leaf C1 — the Providers route answers "which upstream accounts work right now?".
//
// Every assertion reads a state name, a word an operator can see, or a count.
// No Tailwind class name is asserted: the class list is an implementation detail
// and a test that reads it fails on a rename while passing on a real regression.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  classifyConnection,
  summarizeProviderConnections,
} from "@/app/(dashboard)/dashboard/providers/connectionStatus.js";
import ProviderStatusTokens from "@/app/(dashboard)/dashboard/providers/components/ProviderStatusTokens.js";

const NOW = Date.parse("2026-08-30T12:00:00.000Z");
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// Shapes taken from the live `GET /api/providers` payload the lead captured.
const healthy = {
  id: "c-healthy",
  provider: "openai",
  isActive: true,
  testStatus: "active",
  expiresAt: iso(30 * DAY),
};

// Cooldown still running: routing is blocked right now and the lock carries the
// moment it lifts.
const rateLimited = {
  id: "c-429",
  provider: "claude",
  isActive: true,
  testStatus: "unavailable",
  errorCode: 429,
  lastError: "Rate limit exceeded",
  lastErrorAt: iso(-2 * MINUTE),
  "modelLock_claude-opus-4": iso(15 * MINUTE),
  expiresAt: iso(30 * DAY),
};

// Access token thirteen days past expiry — the live claude rows.
const expired = {
  id: "c-expired",
  provider: "claude",
  authType: "oauth",
  isActive: true,
  testStatus: "active",
  expiresAt: iso(-13 * DAY),
};

// Carries an error code, cooldown already lapsed. This is the row the old code
// rewrote to "active".
const errored = {
  id: "c-404",
  provider: "claude",
  isActive: true,
  testStatus: "unavailable",
  errorCode: 404,
  lastError: "model not found",
  lastErrorAt: iso(-3 * DAY),
  expiresAt: iso(30 * DAY),
};

// A test run that came back failing — distinct from a lapsed cooldown.
const testFailed = {
  id: "c-err",
  provider: "kiro",
  isActive: true,
  testStatus: "error",
  errorCode: 401,
  lastError: "unauthorized",
  lastErrorAt: iso(-1 * MINUTE),
  expiresAt: iso(30 * DAY),
};

const disabled = { id: "c-off", provider: "kiro", isActive: false, testStatus: "active" };

describe("classifyConnection", () => {
  it("C1-1: an expired credential is never connected", () => {
    const r = classifyConnection(expired, NOW);
    expect(r.state).not.toBe("connected");
    expect(r.state).toBe("expired");
    expect(r.label).toMatch(/expired/i);
    expect(r.action).toMatch(/reconnect/i);
  });

  it("C1-2: a live cooldown reads as rate limited and names when it lifts", () => {
    const r = classifyConnection(rateLimited, NOW);
    expect(r.state).toBe("rate_limited");
    expect(r.label).toMatch(/rate limited/i);
    expect(r.action).toMatch(/15m/);
  });

  it("C1-2: a non-429 cooldown is still not connected", () => {
    const { "modelLock_claude-opus-4": _dropped, ...base } = rateLimited;
    const r = classifyConnection(
      { ...base, errorCode: 503, modelLock___all: iso(90 * MINUTE) },
      NOW,
    );
    expect(r.state).toBe("cooling_down");
    expect(r.state).not.toBe("connected");
    expect(r.action).toMatch(/90m/);
  });

  it("C1-2: the soonest cooldown is the one quoted", () => {
    const r = classifyConnection(
      { ...rateLimited, modelLock___all: iso(90 * MINUTE) },
      NOW,
    );
    expect(r.action).toMatch(/15m/);
  });

  it("C1-3: an error code that outlived its cooldown is reported, not swallowed", () => {
    const r = classifyConnection(errored, NOW);
    expect(r.state).not.toBe("connected");
    expect(r.state).toBe("recovering");
    expect(r.detail).toBe("404");
    expect(r.action).toBeTruthy();
    // The old rewrite's judgement survives: routing will use this connection
    // again, so it is not painted as a hard failure.
    expect(r.tone).toBe("degraded");
  });

  it("C1-3: a failed test is a hard failure, not a lapsed cooldown", () => {
    const r = classifyConnection(testFailed, NOW);
    expect(r.state).toBe("failing");
    expect(r.tone).toBe("failing");
    expect(r.detail).toBe("401");
    expect(r.action).toBeTruthy();
  });

  it("a healthy connection stays connected", () => {
    expect(classifyConnection(healthy, NOW).state).toBe("connected");
  });

  it("a connection turned off reads as disabled, not as broken", () => {
    expect(classifyConnection(disabled, NOW).state).toBe("disabled");
  });

  it("a connection never tested is not claimed as working", () => {
    const r = classifyConnection({ id: "c-new", isActive: true }, NOW);
    expect(r.state).not.toBe("connected");
  });
});

describe("summarizeProviderConnections", () => {
  const fixture = [healthy, expired, rateLimited, errored, testFailed, disabled];

  it("C1-5: counts agree with the per-connection states", () => {
    const s = summarizeProviderConnections(fixture, NOW);
    expect(s.total).toBe(6);
    expect(s.connected).toBe(1);

    const summed = s.states.reduce((n, entry) => n + entry.count, 0);
    expect(summed).toBe(s.total);

    const byState = Object.fromEntries(s.states.map((e) => [e.state, e.count]));
    expect(byState).toEqual({
      expired: 1,
      failing: 1,
      rate_limited: 1,
      recovering: 1,
      disabled: 1,
      connected: 1,
    });
  });

  it("C1-5: every connection classifies into exactly one summary bucket", () => {
    const s = summarizeProviderConnections(fixture, NOW);
    const perRow = fixture.map((c) => classifyConnection(c, NOW).state);
    for (const entry of s.states) {
      expect(perRow.filter((state) => state === entry.state).length).toBe(entry.count);
    }
  });

  it("the failing states are surfaced ahead of the healthy one", () => {
    const s = summarizeProviderConnections(fixture, NOW);
    expect(s.states.at(-1).state).toBe("connected");
  });

  it("all-off connections are reported as disabled", () => {
    const s = summarizeProviderConnections([disabled, { ...disabled, id: "c-off2" }], NOW);
    expect(s.allDisabled).toBe(true);
  });
});

describe("ProviderStatusTokens", () => {
  const render = (conns) =>
    renderToStaticMarkup(
      createElement(ProviderStatusTokens, {
        summary: summarizeProviderConnections(conns, NOW),
      }),
    );

  it("C1-4: every state carries a word, never hue alone", () => {
    const html = render([healthy, expired, rateLimited, errored]);
    expect(html).toMatch(/Connected/);
    expect(html).toMatch(/Expired/i);
    expect(html).toMatch(/Rate limited/i);
    // Decorative glyphs are hidden from assistive tech; the word is not.
    expect(html).toMatch(/aria-hidden="true"/);
  });

  it("C1-2 / C1-3: a rate-limited or errored card says what to do next", () => {
    const html = render([rateLimited]);
    expect(html).toMatch(/15m/);

    const erroredHtml = render([errored]);
    expect(erroredHtml).toMatch(/404/);
  });

  it("a fully healthy provider says only that", () => {
    const html = render([healthy]);
    expect(html).toMatch(/1 Connected/);
    expect(html).not.toMatch(/Expired|Rate limited|Error/i);
  });

  it("renders nothing but a disabled word when the provider is switched off", () => {
    const html = render([disabled]);
    expect(html).toMatch(/Disabled/i);
  });
});
