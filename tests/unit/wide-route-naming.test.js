// @vitest-environment jsdom
//
// Naming and heading contract for the eight routes the five-route accessibility
// sample never showed (leaf A6): combos, quota, token-saver, cli-tools, memory
// and the gallery.
//
// Everything here is asserted as a role, a heading level or an accessible name.
// No Tailwind class is asserted: the class list is an implementation detail, and
// the 44px pointer target is a computed layout fact only
// an accessibility probe run against a live instance can measure.

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace() {}, push() {} }),
  usePathname: () => '/dashboard',
}));

// Next's client Link schedules its own state update during the gallery's
// static route render. A plain anchor preserves the navigation contract here
// without leaking that update into unrelated mounted-route assertions.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }) => createElement('a', { href, ...rest }, children),
}));

const { default: MemoryClient } =
  await import('@/app/(dashboard)/dashboard/memory/MemoryClient.js');
const { default: CLIToolsPageClient } =
  await import('@/app/(dashboard)/dashboard/cli-tools/CLIToolsPageClient.js');
const { default: GalleryPage } = await import('@/app/(dashboard)/dashboard/gallery/page.js');
const { default: TokenSaverClient } =
  await import('@/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js');
const { classifyConnection } =
  await import('@/app/(dashboard)/dashboard/providers/connectionStatus.js');
const { freshnessTone } = await import('@/app/(dashboard)/dashboard/home/formatMeasure.js');
const { NOT_COMPUTABLE, NOT_RECORDED } = await import('@/shared/utils/measure.js');
const { default: CombosPage } = await import('@/app/(dashboard)/dashboard/combos/page.js');
const { default: ProviderLimits } = await import(
  '@/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js'
);

// --- helpers ---------------------------------------------------------------

const dom = (element) => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  return host;
};

// A route that draws a skeleton until its first fetch resolves is invisible to
// renderToStaticMarkup, which runs no effects. These mount for real and let the
// effects settle, which is the only way the controls under test exist at all.
const mounted = async (element) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    createRoot(host).render(element);
  });
  return host;
};

// "content_copy" and "rocket_launch" are Material ligatures. They are text
// content, so a naive reader calls the button named; they are a glyph, so a
// screen reader user hears nothing useful. Rejecting the shape is what makes
// these assertions mean anything.
const LIGATURE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

const accessibleName = (el) => {
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return aria.trim();
  if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
    if (el.id) {
      // getRootNode, not ownerDocument: a tree built through innerHTML on a
      // detached host is never in the document, so document.querySelector finds
      // nothing and every field looks unlabelled.
      const label = el.getRootNode().querySelector(`label[for="${el.id}"]`);
      if (label?.textContent?.trim()) return label.textContent.trim();
    }
    if (el.closest('label')?.textContent?.trim()) return el.closest('label').textContent.trim();
  }
  const clone = el.cloneNode(true);
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  const text = clone.textContent.trim();
  if (text && !LIGATURE.test(text)) return text;
  const title = el.getAttribute('title');
  return title?.trim() || '';
};

const headingLevels = (host) =>
  [...host.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1]));

// The dashboard shell renders the route's own h1 above every one of these
// components, so a route body opening at h3 is a skipped level even though the
// body on its own looks fine. Every case below is measured with that h1 in
// front of it, which is what the probe sees.
const outlineUnderShellH1 = (host) => [1, ...headingLevels(host)];

const skippedLevels = (levels) => {
  const gaps = [];
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) gaps.push(`h${levels[i - 1]}->h${levels[i]}`);
  }
  return gaps;
};

const unnamedSwitches = (host) =>
  [...host.querySelectorAll('[role="switch"]')].filter((s) => !accessibleName(s));

// --- A6-1 / A6-2: /dashboard/memory ----------------------------------------

describe('/dashboard/memory', () => {
  let host;
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({ ok: false }));
    host = dom(createElement(MemoryClient));
  });
  afterEach(() => vi.restoreAllMocks());

  it('names every switch after the pipeline stage it turns on', () => {
    const names = [...host.querySelectorAll('[role="switch"]')].map(accessibleName);
    expect(names).toEqual([
      'Historical tool output pruning',
      'Historical media and attachment pruning',
      'Sliding window context compaction',
      'Cross-session handoff continuity',
    ]);
  });

  it('labels every number field, so none of them is an unlabelled box', () => {
    const inputs = [...host.querySelectorAll('input')];
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) expect(accessibleName(input)).not.toBe('');
  });

  it('names the two fields the probe found bare', () => {
    expect(accessibleName(host.querySelector('#memory-tool-turns-keep-full'))).toBe(
      'Keep Recent Tool Turns Full'
    );
    expect(accessibleName(host.querySelector('#memory-max-historical-tool-chars'))).toBe(
      'Max Historical Output Length (chars)'
    );
  });

  // --- A6-4 ---
  it('leaves the page h1 to the shell and skips no heading level', () => {
    expect(host.querySelectorAll('h1')).toHaveLength(0);
    expect(skippedLevels(outlineUnderShellH1(host))).toEqual([]);
  });
});

// --- A6-1: /dashboard/combos -----------------------------------------------

describe('/dashboard/combos', () => {
  let host;
  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    host = await mounted(createElement(CombosPage));
  });
  afterEach(() => vi.restoreAllMocks());

  it('names each capacity-adapter switch after the capability it acts on', () => {
    const names = [...host.querySelectorAll('[role="switch"]')].map(accessibleName);
    expect(names).toEqual([
      'Enable Vision adapter',
      'Round-robin Vision adapter',
      'Enable Audio adapter',
      'Round-robin Audio adapter',
    ]);
  });

  it('leaves no control named only by a Material ligature', () => {
    for (const button of host.querySelectorAll('button')) {
      const name = accessibleName(button);
      expect(name).not.toBe('');
      expect(LIGATURE.test(name)).toBe(false);
    }
  });
});

// --- A6-1 / A6-3: /dashboard/quota -----------------------------------------

describe('/dashboard/quota', () => {
  const CONNECTIONS = [
    { id: 'c1', provider: 'codex', name: 'work@example.com', authType: 'oauth', isActive: true },
    {
      id: 'c2',
      provider: 'claude',
      name: 'personal@example.com',
      authType: 'oauth',
      isActive: false,
    },
  ];

  let host;
  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      const body = u.includes('/api/providers/client')
        ? {
            connections: CONNECTIONS,
            pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
            totals: { eligibleConnections: 2, providerFilteredConnections: 2 },
            providerOptions: [],
          }
        : u.includes('proxy-pools')
          ? []
          : {};
      return { ok: true, status: 200, json: async () => body };
    });
    host = await mounted(createElement(ProviderLimits));
  });
  afterEach(() => vi.restoreAllMocks());

  // The whole point of the scheme: a row repeats its controls per account, so a
  // name that does not carry the account is read aloud identically N times.
  it('says which account every row control acts on', () => {
    const names = [...host.querySelectorAll('button')].map(accessibleName);
    for (const verb of [
      'Refresh quota for',
      'Edit connection',
      'Delete connection',
      'Toggle auto-ping for',
    ]) {
      const matches = names.filter((n) => n.startsWith(verb));
      expect(matches).toHaveLength(2);
      expect(matches.some((n) => n.includes('codex work@example.com'))).toBe(true);
      expect(matches.some((n) => n.includes('claude personal@example.com'))).toBe(true);
    }
  });

  it('names the connection switch after the account it turns off', () => {
    const names = [...host.querySelectorAll('[role="switch"]')].map(accessibleName);
    expect(names).toEqual([
      'Disable connection codex work@example.com',
      'Enable connection claude personal@example.com',
    ]);
  });

  it('leaves no control named only by a Material ligature', () => {
    for (const button of host.querySelectorAll('button')) {
      const name = accessibleName(button);
      expect(name).not.toBe('');
      expect(LIGATURE.test(name)).toBe(false);
    }
  });

  // --- A6-3 ---
  it('starts its cards at h2, so the shell h1 is not followed by an h3', () => {
    expect(host.querySelectorAll('h1')).toHaveLength(0);
    expect(skippedLevels(outlineUnderShellH1(host))).toEqual([]);
  });
});

// --- A6-1: /dashboard/token-saver ------------------------------------------

describe('/dashboard/token-saver', () => {
  let host;
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = vi.fn(async () => ({ ok: false }));
    host = dom(createElement(TokenSaverClient));
  });
  afterEach(() => vi.restoreAllMocks());

  it('leaves no switch for a screen reader to guess at', () => {
    expect(unnamedSwitches(host)).toHaveLength(0);
  });

  it('names each switch after the reduction it turns on', () => {
    const names = [...host.querySelectorAll('[role="switch"]')].map(accessibleName);
    expect(names).toContain('Compress tool output with RTK');
    expect(names).toContain('Compress LLM output with Caveman');
    expect(names).toContain('Bias code output toward minimal with Ponytail');
    expect(names).toContain('Rank tools per turn with BM25');
  });
});

// --- A6-3: /dashboard/cli-tools --------------------------------------------

describe('/dashboard/cli-tools', () => {
  let host;
  beforeEach(async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    host = await mounted(createElement(CLIToolsPageClient, { machineId: 'test-machine' }));
  });
  afterEach(() => vi.restoreAllMocks());

  it('gives the tool grid a group heading, so no card starts at h3 under the shell h1', () => {
    const h2s = [...host.querySelectorAll('h2')].map((h) => h.textContent.trim());
    expect(h2s).toEqual(['Agent CLIs', 'MITM Tools']);
    expect(host.querySelectorAll('h3').length).toBeGreaterThan(0);
    expect(skippedLevels(outlineUnderShellH1(host))).toEqual([]);
  });
});

// --- A6-4 / A6-5: /dashboard/gallery ---------------------------------------

describe('/dashboard/gallery', () => {
  const host = dom(createElement(GalleryPage));
  const tokens = () => [...host.querySelectorAll('#status span')].map((s) => s.textContent.trim());

  it('leaves the page h1 to the shell and skips no heading level', () => {
    expect(host.querySelectorAll('h1')).toHaveLength(0);
    expect(skippedLevels(outlineUnderShellH1(host))).toEqual([]);
  });

  // The point of these two is that the gallery describes the PRODUCT. They fail
  // when a state is added to a consumer and the gallery is not updated with it,
  // which is the drift the gate exists to stop.
  it('shows every provider connection state the product can produce', () => {
    const text = host.querySelector('#status').textContent;
    const cases = [
      [{ isActive: true, testStatus: 'active' }, 'connected'],
      [{ isActive: true, testStatus: 'unavailable' }, 'recovering'],
      [
        { isActive: true, lastErrorType: 'upstream_rate_limited', modelLock_m: Date.now() + 60000 },
        'rate_limited',
      ],
      [{ isActive: true, modelLock_m: Date.now() + 60000 }, 'cooling_down'],
      [{ isActive: true, expiresAt: Date.now() - 60000 }, 'expired'],
      [{ isActive: true, testStatus: 'error' }, 'failing'],
      [{ isActive: false }, 'disabled'],
      [{ isActive: true }, 'unknown'],
    ];
    for (const [conn, expectedState] of cases) {
      const s = classifyConnection(conn);
      expect(s.state).toBe(expectedState);
      expect(text).toContain(s.label);
    }
    expect(new Set(cases.map(([c]) => classifyConnection(c).label)).size).toBe(8);
  });

  it("shows the masthead's freshness tones in the words the masthead uses", () => {
    const text = host.querySelector('#status').textContent;
    for (const state of ['live', 'refreshing', 'stale', 'empty', 'nonsense']) {
      // `stale` carries an age, so the gallery states one; the word is the part
      // that has to agree.
      const { label } = freshnessTone({ state, ageSeconds: 840 });
      expect(text).toContain(label.split(',')[0]);
    }
    expect(text).toContain('upstreams degraded');
  });

  it('shows a readout that could not be computed apart from one never recorded', () => {
    const text = host.querySelector('#readout').textContent;
    expect(NOT_COMPUTABLE).not.toBe(NOT_RECORDED);
    expect(text).toContain(NOT_COMPUTABLE);
    expect(text).toContain(NOT_RECORDED);
    // A measured figure still sits beside them, or the contrast documents nothing.
    expect(text).toContain('req/min');
  });

  it('gives every gallery status token a word, not only a colour', () => {
    const words = tokens();
    expect(words.length).toBeGreaterThan(0);
    for (const t of words) expect(t).not.toBe('');
  });
});
