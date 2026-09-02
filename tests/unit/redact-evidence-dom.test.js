import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildEvidencePrivacyContext,
  maskEvidenceDom,
} from "../../docs/design/verification/redactEvidence.mjs";

const originalGlobals = {
  document: globalThis.document,
  NodeFilter: globalThis.NodeFilter,
};

afterEach(() => {
  globalThis.document = originalGlobals.document;
  globalThis.NodeFilter = originalGlobals.NodeFilter;
});

describe("browser evidence privacy", () => {
  it("neutralizes live topology and status while retaining route capabilities", async () => {
    const dom = new JSDOM(`
      <body>
        <a href="/dashboard/providers/claude">
          <h3>Claude</h3>
          <span class="text-danger border-danger/40">1 Error · AUTH</span>
        </a>
        <div class="react-flow">
          <span>Rack West Gateway</span>
          <span>Active</span>
        </div>
        <p title="connection 123e4567-e89b-12d3-a456-426614174000">
          operator@example.test uses Rack West Gateway
        </p>
        <p id="live-error" class="text-danger">Last call failed</p>
        <button>Add provider</button>
      </body>
    `);
    globalThis.document = dom.window.document;
    globalThis.NodeFilter = dom.window.NodeFilter;
    const context = buildEvidencePrivacyContext({
      connections: [{
        id: "123e4567-e89b-12d3-a456-426614174000",
        provider: "claude",
        testStatus: "error",
      }],
      nodes: [{ name: "Rack West Gateway" }],
    });

    await maskEvidenceDom(context);

    expect(document.querySelector(".react-flow").textContent).toBe("[operational-topology-redacted]");
    expect(document.querySelector('a[href="/dashboard/providers/claude"]').textContent)
      .toMatch(/\[redacted-connected-provider-[a-f0-9]{12}\]/);
    expect(document.body.textContent).toContain("Add provider");
    expect(document.body.textContent).not.toContain("Rack West Gateway");
    expect(document.body.textContent).not.toContain("operator@example.test");
    expect(document.body.innerHTML).not.toContain("123e4567-e89b-12d3-a456-426614174000");
    expect(document.querySelector("#live-error").textContent).toBe("[redacted-live-status]");
    expect(document.querySelector("#live-error").style.color).toBe("inherit");
  });

  it("removes masked client-key fragments and isolated local endpoints from capture DOM", async () => {
    const dom = new JSDOM(`
      <body>
        <p id="key">sk-a23&bull;&bull;&bull;&bull;&bull;&bull;f9e0</p>
        <input value="http://127.0.0.1:20150/v1" />
        <button>Copy endpoint</button>
      </body>
    `);
    globalThis.document = dom.window.document;
    globalThis.NodeFilter = dom.window.NodeFilter;

    await maskEvidenceDom();

    expect(document.body.textContent).not.toContain("sk-a23");
    expect(document.body.innerHTML).not.toContain("127.0.0.1:20150");
    expect(document.body.textContent).toContain("Copy endpoint");
  });

  it("masks live telemetry and status pills that carry no credential", async () => {
    // Every one of these rendered into a committed screenshot. None is a
    // credential, and all of them are live deployment data.
    const dom = new JSDOM(`
      <body>
        <div id="strip">0.42 req/min · SPEND 12.3400 USD · CONNECTED 13</div>
        <p id="quota">Total Requests 4,521 · Est. Cost ~$361.57</p>
        <p id="sub">Subscription active until Sep 10, 2026</p>
        <p id="pill">GitHub Copilot — No connections</p>
        <p id="cache">CACHE HIT RATE 91.2%</p>
        <button>Add provider</button>
      </body>
    `);
    globalThis.document = dom.window.document;
    globalThis.NodeFilter = dom.window.NodeFilter;

    await maskEvidenceDom();

    const text = document.body.textContent;
    for (const live of ["0.42", "12.3400", "13", "4,521", "361.57", "91.2", "Sep 10, 2026"]) {
      expect(text).not.toContain(live);
    }
    expect(document.querySelector("#pill").textContent).toContain("[redacted-live-status]");
    // The layout still has to be reviewable, so labels and controls survive.
    expect(text).toContain("Add provider");
    expect(text).toContain("SPEND");
    expect(text).toContain("CACHE HIT RATE");
  });

  it("keeps an alias it already wrote readable", async () => {
    // Digit masking runs after aliasing. Masking the hex tail of an alias would
    // destroy the alias without hiding anything the alias had not already hidden.
    const dom = new JSDOM(`<body><p id="a">[redacted-connected-provider-57de4cf40144]</p></body>`);
    globalThis.document = dom.window.document;
    globalThis.NodeFilter = dom.window.NodeFilter;

    await maskEvidenceDom();

    expect(document.querySelector("#a").textContent)
      .toBe("[redacted-connected-provider-57de4cf40144]");
  });
});
