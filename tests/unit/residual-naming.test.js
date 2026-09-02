// @vitest-environment jsdom
//
// Residual naming and landmark contract (leaf A5). The three routes the probe
// rebuild exposed once it stopped following /login's redirect and started
// hit-testing the pointer target instead of the drawn box.
//
// Everything here is asserted as a role, a landmark or an accessible name. No
// Tailwind class is asserted: the class list is an implementation detail, and
// the 44px pointer target is a computed layout fact that only
// an accessibility probe run against a live instance can measure.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// StatisticsContent reads the URL through next/navigation, which has no
// provider outside the app router.
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace() {}, push() {} }),
  usePathname: () => '/dashboard/statistics',
}));

const { default: Pagination } = await import('@/shared/components/Pagination.js');
const { default: UsageTable } =
  await import('@/app/(dashboard)/dashboard/usage/components/UsageTable.js');
const { default: ConnectionRow } =
  await import('@/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js');
const { default: StatisticsContent } =
  await import('@/app/(dashboard)/dashboard/statistics/StatisticsContent.js');

// --- helpers ---------------------------------------------------------------

const dom = (element) => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  return host;
};

const LIGATURE = /^[a-z0-9]+(_[a-z0-9]+)*$/;
const accessibleName = (el) => {
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return aria.trim();
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(' ');
    if (t) return t;
  }
  if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
    if (el.id) {
      const label = el.ownerDocument.querySelector(`label[for="${el.id}"]`);
      if (label?.textContent?.trim()) return label.textContent.trim();
    }
    if (el.closest('label')?.textContent?.trim()) return el.closest('label').textContent.trim();
  }
  const text = el.textContent.trim();
  if (text && !LIGATURE.test(text)) return text;
  const title = el.getAttribute('title');
  return title?.trim() || '';
};

// --- A5-1: the switches beside a provider connection -----------------------

describe('provider connection switch', () => {
  const row = (isActive) =>
    dom(
      createElement(ConnectionRow, {
        connection: { id: 'c1', name: 'Prod key', authType: 'apikey', isActive },
        proxyPools: [],
        isOAuth: false,
        isFirst: true,
        isLast: true,
        onMoveUp: () => {},
        onMoveDown: () => {},
        onToggleActive: () => {},
        onUpdateProxy: () => {},
        onEdit: () => {},
        onDelete: () => {},
      })
    ).querySelector('[role="switch"]');

  it('says which connection it disables, not just "Disable"', () => {
    expect(accessibleName(row(true))).toBe('Disable connection Prod key');
  });

  it('says which connection it enables when the connection is off', () => {
    expect(accessibleName(row(false))).toBe('Enable connection Prod key');
  });
});

// --- A5-2 / A5-3: the statistics route -------------------------------------

describe('/dashboard/statistics request details', () => {
  const HEADERS = [
    'Time',
    'Provider',
    'Account',
    'Model',
    'Input',
    'Output',
    'Cache Read',
    'Cache Write',
    'Hit Rate',
    'Time/TTFT',
    'Status',
  ];
  let host;
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = vi.fn(async () => ({ ok: false }));
    host = dom(createElement(StatisticsContent, { initialData: undefined }));
  });
  afterEach(() => vi.restoreAllMocks());

  it('names the table after what its rows hold', () => {
    expect(accessibleName(host.querySelector('table'))).toBe('Request Details');
  });

  it('lets a keyboard reach the scroll region that holds the wide table', () => {
    const region = host.querySelector('[role="region"]');
    expect(accessibleName(region)).toBe('Request Details');
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.querySelector('table')).not.toBeNull();
  });

  it('still renders every column it rendered as raw markup', () => {
    const headers = [...host.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    expect(headers).toEqual(HEADERS);
  });

  it('names the rows-per-page select', () => {
    const select = host.querySelector('select[aria-label="Rows per page"]');
    expect(accessibleName(select)).toBe('Rows per page');
  });

  it('names the phone period selector separately from table pagination', () => {
    const select = host.querySelector('select[aria-label="Statistics period"]');
    expect(accessibleName(select)).toBe('Statistics period');
  });
});

// --- A5-2 / A5-3: the usage route ------------------------------------------

describe('usage table', () => {
  const props = {
    title: '',
    columns: [
      { field: 'rawModel', label: 'Model' },
      { field: 'provider', label: 'Provider' },
    ],
    groupedData: [],
    tableType: 'model',
    sortBy: 'cost',
    sortOrder: 'desc',
    onToggleSort: () => {},
    viewMode: 'tokens',
    storageKey: 'usage-stats:expanded-models',
    renderSummaryCells: () => null,
    renderDetailCells: () => null,
    emptyMessage: 'No usage recorded yet.',
  };

  it('names the table after the grouping it is showing when the visible header is empty', () => {
    const host = dom(createElement(UsageTable, props));
    expect(accessibleName(host.querySelector('table'))).toBe('Usage by model');
  });

  it('prefers the visible header when there is one', () => {
    const host = dom(createElement(UsageTable, { ...props, title: 'Top accounts' }));
    expect(accessibleName(host.querySelector('table'))).toBe('Top accounts');
  });

  it('lets a keyboard reach its scroll region', () => {
    const region = dom(createElement(UsageTable, props)).querySelector('[role="region"]');
    expect(accessibleName(region)).toBe('Usage by model');
    expect(region.getAttribute('tabindex')).toBe('0');
  });

  it('still renders every column it rendered as raw markup', () => {
    const headers = [...dom(createElement(UsageTable, props)).querySelectorAll('thead th')].map(
      (th) => th.textContent.replace(/[↕↑↓]/g, '').trim()
    );
    // Two grouping columns, then the four token value columns.
    expect(headers).toEqual([
      'Model',
      'Provider',
      'Input Tokens',
      'Cached',
      'Output Tokens',
      'Total Tokens',
    ]);
  });
});

describe('Pagination', () => {
  it('names the page-size select for every table that paginates', () => {
    const host = dom(
      createElement(Pagination, {
        currentPage: 1,
        pageSize: 20,
        totalItems: 60,
        onPageChange: () => {},
        onPageSizeChange: () => {},
      })
    );
    expect(accessibleName(host.querySelector('select'))).toBe('Rows per page');
  });
});

// --- A5-5: /login, which renders outside the dashboard shell ---------------
//
// The route is only itself once /api/auth/status has answered: before that it
// renders a spinner. So it is mounted for real against a stubbed API.

describe('/login', () => {
  let host, root, act, LoginPage;

  beforeEach(async () => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    // The banner's theme toggle reads the system colour scheme; jsdom ships no
    // matchMedia, so it is stubbed rather than the hook being weakened.
    window.matchMedia = (query) => ({
      matches: false, media: query, onchange: null,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}, dispatchEvent: () => false,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        requireLogin: true,
        hasPassword: true,
        authMode: 'password',
        authenticated: false,
      }),
    }));
    ({ act } = await import('react'));
    ({ default: LoginPage } = await import('@/app/login/page.js'));
    const { createRoot } = await import('react-dom/client');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(LoginPage));
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('renders the password form, not the loading spinner', () => {
    expect(host.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('opens the tab order with a skip link that lands on a real target', () => {
    const skip = host.querySelector('a[href^="#"]');
    expect(accessibleName(skip)).toBe('Skip to main content');
    expect(host.querySelector(skip.getAttribute('href'))).not.toBeNull();
  });

  it('carries the four landmarks the dashboard shell gives every other route', () => {
    expect(host.querySelector('main#main')).not.toBeNull();
    expect(host.querySelector('header')).not.toBeNull();
    expect(host.querySelector('footer')).not.toBeNull();
    const nav = host.querySelector('nav');
    expect(nav).not.toBeNull();
    expect(nav.getAttribute('aria-label')).toBeTruthy();
  });

  it('keeps the banner and the footer outside the main landmark', () => {
    expect(host.querySelector('main header')).toBeNull();
    expect(host.querySelector('main footer')).toBeNull();
    expect(host.querySelector('main nav')).toBeNull();
  });

  it('has exactly one h1', () => {
    expect(host.querySelectorAll('h1').length).toBe(1);
  });

  it('names the password field and every button on the page', () => {
    expect(accessibleName(host.querySelector('input[type="password"]'))).toBe('Password');
    for (const el of host.querySelectorAll('button')) {
      const name = accessibleName(el);
      expect(name, `button with content ${JSON.stringify(el.textContent.trim())}`).not.toBe('');
      expect(
        LIGATURE.test(name),
        `accessible name ${JSON.stringify(name)} is a glyph, not a name`
      ).toBe(false);
    }
  });
});
