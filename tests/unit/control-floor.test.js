// @vitest-environment jsdom
//
// Control-floor contract (leaf A3): every control a pointer or a screen reader
// meets on a feature route says what it DOES, and every data table says what it
// holds.
//
// Everything here is asserted as a role or an accessible name. No Tailwind class
// is asserted — the class list is an implementation detail, and a test that
// reads it fails on a rename while passing on a real regression. That is also
// why the 44px pointer target is NOT tested here: it is a computed layout fact,
// and the thing that measures it is a nine-point hit test in a real browser.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { default: Toggle } = await import('@/shared/components/Toggle.js');
const { default: Table, THead, TR, TH, TBody, TD } = await import('@/shared/components/Table.js');
const { default: EndpointRow } = await import('@/app/(dashboard)/dashboard/endpoint/components/EndpointRow.js');

// --- helpers ---------------------------------------------------------------

// Parse rendered markup into a real document so the assertions read attributes
// off elements rather than off a string.
const dom = (element) => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  return host;
};

// The accessible name of a control, computed the way axe's `button-name` and
// `label` rules compute it, minus the parts none of these controls use.
// A Material Symbols ligature is glyph text, not a name: "content_copy" tells a
// screen-reader user what the icon looks like, never what the button does.
const LIGATURE = /^[a-z0-9]+(_[a-z0-9]+)*$/;
const accessibleName = (el) => {
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return aria.trim();
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
    if (t) return t;
  }
  if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
    if (el.id) {
      const label = el.ownerDocument.querySelector(`label[for="${el.id}"]`);
      if (label?.textContent?.trim()) return label.textContent.trim();
    }
    if (el.closest('label')?.textContent?.trim()) return el.closest('label').textContent.trim();
  }
  // Ligature-only text is discarded before the title fallback, so a button whose
  // whole content is an icon falls through to its title rather than being named
  // after the glyph.
  const text = el.textContent.trim();
  if (text && !LIGATURE.test(text)) return text;
  const title = el.getAttribute('title');
  return title?.trim() || '';
};

// --- Toggle ----------------------------------------------------------------

describe('Toggle', () => {
  let warn;
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => warn.mockRestore());

  const sw = (props) => dom(createElement(Toggle, props)).querySelector('[role="switch"]');

  it('is a switch that reports its state', () => {
    expect(sw({ ariaLabel: 'Require API key', checked: true }).getAttribute('aria-checked')).toBe('true');
    expect(sw({ ariaLabel: 'Require API key', checked: false }).getAttribute('aria-checked')).toBe('false');
  });

  it('takes its accessible name from ariaLabel, label or title', () => {
    expect(accessibleName(sw({ ariaLabel: 'Require API key' }))).toBe('Require API key');
    expect(accessibleName(sw({ label: 'Allow dashboard access via tunnel' }))).toBe('Allow dashboard access via tunnel');
    expect(accessibleName(sw({ title: 'Pause API key Default Key' }))).toBe('Pause API key Default Key');
  });

  it('forwards title to the control rather than dropping it', () => {
    // The prop was accepted at call sites and silently discarded, so the
    // hover hint never rendered and never became a name either.
    expect(sw({ title: 'Pause key' }).getAttribute('title')).toBe('Pause key');
  });

  it('warns instead of shipping a switch with no accessible name', () => {
    expect(accessibleName(sw({ checked: false }))).toBe('');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/accessible name/i);
  });
});

// --- Table -----------------------------------------------------------------

describe('Table', () => {
  const rows = [
    createElement(THead, { key: 'h' }, createElement(TR, null, createElement(TH, null, 'Upstream'))),
    createElement(TBody, { key: 'b' }, createElement(TR, null, createElement(TD, null, 'claude-code'))),
  ];

  it('names the table and its scroll region, and lets a keyboard reach the region', () => {
    const host = dom(createElement(Table, { label: 'Upstream channels' }, rows));
    expect(accessibleName(host.querySelector('table'))).toBe('Upstream channels');
    const region = host.querySelector('[role="region"]');
    expect(accessibleName(region)).toBe('Upstream channels');
    // axe `scrollable-region-focusable`: a container that scrolls has to be
    // reachable by keyboard or its content is unreadable without a mouse.
    expect(region.getAttribute('tabindex')).toBe('0');
  });

  it('warns instead of shipping an unnamed table', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    dom(createElement(Table, null, rows));
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

// --- EndpointRow -----------------------------------------------------------

describe('EndpointRow', () => {
  const host = () => dom(createElement(EndpointRow, {
    label: 'Local', url: 'http://127.0.0.1:20128/v1', copyId: 'local_url', copied: null, onCopy: () => {},
  }));

  it('names the read-only URL field after the endpoint it holds', () => {
    expect(accessibleName(host().querySelector('input'))).toBe('Local endpoint URL');
  });

  it('names the copy button by what it copies, not by its glyph', () => {
    const name = accessibleName(host().querySelector('button'));
    expect(name).toBe('Copy endpoint URL');
    expect(name).not.toBe('content_copy');
  });
});

// --- the /dashboard route itself -------------------------------------------
//
// The two axe `button-name` violations and the one `label` violation the probe
// reports on /dashboard are all on this page, and none of them is reachable
// until its effects have run: the component renders skeletons while `loading`
// is true. So it is mounted for real against a stubbed API.

describe('/dashboard endpoint page', () => {
  let host, root, act, EndpointPageClient;

  const API = {
    '/api/settings': { requireApiKey: true, requireLogin: true, hasPassword: true, tunnelDashboardAccess: true },
    '/api/tunnel/status': {
      tunnel: { settingsEnabled: true, tunnelUrl: 'https://demo.trycloudflare.com', publicUrl: '' },
      tailscale: { settingsEnabled: true, tunnelUrl: 'https://box.ts.net' },
    },
    '/api/keys': { keys: [{ id: 'k1', name: 'Default Key', key: 'sk-tp-abcdef0123456789', isActive: true, createdAt: '2026-08-01T00:00:00Z' }] },
  };

  beforeEach(async () => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    global.fetch = vi.fn(async (url) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      return { ok: true, status: 200, json: async () => API[path] ?? {} };
    });
    ({ act } = await import('react'));
    ({ default: EndpointPageClient } = await import('@/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js'));
    const { createRoot } = await import('react-dom/client');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(createElement(EndpointPageClient, { machineId: 'test-machine' })); });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('renders the endpoint content, not the loading skeleton', () => {
    expect(host.querySelectorAll('[role="switch"]').length).toBeGreaterThan(0);
  });

  it('gives every switch an accessible name', () => {
    const switches = [...host.querySelectorAll('[role="switch"]')];
    expect(switches.length).toBeGreaterThanOrEqual(3);
    for (const el of switches) expect(accessibleName(el)).not.toBe('');
  });

  it('names the per-key switch after the key it pauses', () => {
    const names = [...host.querySelectorAll('[role="switch"]')].map(accessibleName);
    expect(names).toContain('Require API key');
    expect(names).toContain('Allow dashboard access via tunnel');
    expect(names).toContain('Pause API key Default Key');
  });

  it('gives every form field an accessible name', () => {
    const fields = [...host.querySelectorAll('input:not([type="hidden"]), select, textarea')];
    expect(fields.length).toBeGreaterThan(0);
    for (const el of fields) expect(accessibleName(el)).not.toBe('');
  });

  it('names every button by what it does, never by a Material Symbols ligature', () => {
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(0);
    for (const el of buttons) {
      const name = accessibleName(el);
      expect(name, `button with content ${JSON.stringify(el.textContent.trim())}`).not.toBe('');
      expect(LIGATURE.test(name), `accessible name ${JSON.stringify(name)} is a glyph, not a name`).toBe(false);
    }
  });
});
